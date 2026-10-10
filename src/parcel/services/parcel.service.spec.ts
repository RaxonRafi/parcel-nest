import { AuditService } from '../../audit/services/audit.service';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PasswordResetService } from '../../auth/services/password-reset.service';
import { RagService } from '../../rag/services/rag.service';
import { ParcelNotificationService } from './parcel-notification.service';
import { UserService } from '../../user/services/user.service';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../user/types/user.types';
import { ParcelStatusLog } from '../entities/parcel-status-log.entity';
import { Parcel } from '../entities/parcel.entity';
import { ParcelStatus } from '../types/parcel.types';
import { ParcelService } from './parcel.service';

/**
 * Covers the delivery-personnel rules. The repository is stubbed per test —
 * these assert authorization, not persistence.
 */
describe('ParcelService — delivery personnel', () => {
  let service: ParcelService;
  let parcelRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let statusLogRepository: { create: jest.Mock; save: jest.Mock };
  let userService: { findDeliveryPersonnelOrFail: jest.Mock };

  const courier = {
    id: 'courier-1',
    name: 'Cal',
    role: Role.DELIVERY_PERSONNEL,
  } as User;
  const otherCourier = {
    id: 'courier-2',
    name: 'Dev',
    role: Role.DELIVERY_PERSONNEL,
  } as User;
  const admin = { id: 'admin-1', name: 'Root', role: Role.ADMIN } as User;

  const buildParcel = (overrides: Partial<Parcel> = {}): Parcel =>
    ({
      id: 'parcel-1',
      trackingId: 'TRK-TEST',
      status: ParcelStatus.IN_TRANSIT,
      isBlocked: false,
      deliveryPersonnel: null,
      statusLogs: [],
      ...overrides,
    }) as Parcel;

  beforeEach(async () => {
    // `persist` writes the parcel and its log row through one transaction;
    // run the callback inline against a stub manager.
    const manager = {
      save: jest.fn(),
      create: jest.fn((_entity: unknown, value: unknown) => value),
    };
    parcelRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      manager: {
        transaction: jest.fn((run: (m: typeof manager) => Promise<void>) =>
          run(manager),
        ),
      },
    };
    statusLogRepository = { create: jest.fn((v) => v), save: jest.fn() };
    userService = { findDeliveryPersonnelOrFail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParcelService,
        { provide: getRepositoryToken(Parcel), useValue: parcelRepository },
        {
          provide: getRepositoryToken(ParcelStatusLog),
          useValue: statusLogRepository,
        },
        { provide: UserService, useValue: userService },
        { provide: RagService, useValue: { indexParcel: jest.fn() } },
        {
          provide: ParcelNotificationService,
          useValue: { notifyStatusChange: jest.fn() },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PasswordResetService, useValue: { issueClaim: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get<ParcelService>(ParcelService);
    // Re-index fires an outbound fetch; the assertions below don't need it.
    jest
      .spyOn(
        service as unknown as { triggerParcelIndex: () => Promise<void> },
        'triggerParcelIndex',
      )
      .mockResolvedValue(undefined);
  });

  describe('updateStatus as a courier', () => {
    it('rejects a parcel assigned to someone else', async () => {
      parcelRepository.findOne.mockResolvedValue(
        buildParcel({ deliveryPersonnel: otherCourier }),
      );

      await expect(
        service.updateStatus(
          'TRK-TEST',
          { status: ParcelStatus.DELIVERED },
          courier,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an unassigned parcel', async () => {
      parcelRepository.findOne.mockResolvedValue(buildParcel());

      await expect(
        service.updateStatus(
          'TRK-TEST',
          { status: ParcelStatus.DELIVERED },
          courier,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each([ParcelStatus.CANCELLED, ParcelStatus.PENDING])(
      'refuses to set %s',
      async (status) => {
        parcelRepository.findOne.mockResolvedValue(
          buildParcel({ deliveryPersonnel: courier }),
        );

        await expect(
          service.updateStatus('TRK-TEST', { status }, courier),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it('allows a delivery status on their own parcel', async () => {
      const parcel = buildParcel({ deliveryPersonnel: courier });
      parcelRepository.findOne.mockResolvedValue(parcel);
      parcelRepository.save.mockResolvedValue(parcel);

      await service.updateStatus(
        'TRK-TEST',
        { status: ParcelStatus.OUT_FOR_DELIVERY },
        courier,
      );

      expect(parcel.status).toBe(ParcelStatus.OUT_FOR_DELIVERY);
    });

    it('leaves admins unrestricted', async () => {
      const parcel = buildParcel();
      parcelRepository.findOne.mockResolvedValue(parcel);
      parcelRepository.save.mockResolvedValue(parcel);

      await service.updateStatus(
        'TRK-TEST',
        { status: ParcelStatus.CANCELLED },
        admin,
      );

      expect(parcel.status).toBe(ParcelStatus.CANCELLED);
    });
  });

  describe('status transitions', () => {
    const move = (from: ParcelStatus, to: ParcelStatus) => {
      const parcel = buildParcel({ status: from, deliveryPersonnel: null });
      parcelRepository.findOne.mockResolvedValue(parcel);
      parcelRepository.save.mockResolvedValue(parcel);
      return service.updateStatus('TRK-TEST', { status: to }, admin);
    };

    it.each([
      [ParcelStatus.PENDING, ParcelStatus.PICKED_UP],
      [ParcelStatus.PICKED_UP, ParcelStatus.IN_TRANSIT],
      [ParcelStatus.IN_TRANSIT, ParcelStatus.OUT_FOR_DELIVERY],
      [ParcelStatus.IN_TRANSIT, ParcelStatus.DELIVERED],
      [ParcelStatus.OUT_FOR_DELIVERY, ParcelStatus.DELIVERED],
      [ParcelStatus.PENDING, ParcelStatus.CANCELLED],
    ])('allows %s → %s', async (from, to) => {
      await expect(move(from, to)).resolves.toBeDefined();
    });

    it('refuses the PENDING → DELIVERED jump', async () => {
      await expect(
        move(ParcelStatus.PENDING, ParcelStatus.DELIVERED),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to move backwards', async () => {
      await expect(
        move(ParcelStatus.OUT_FOR_DELIVERY, ParcelStatus.PENDING),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([ParcelStatus.DELIVERED, ParcelStatus.CANCELLED])(
      'treats %s as final',
      async (terminal) => {
        await expect(move(terminal, ParcelStatus.IN_TRANSIT)).rejects.toThrow(
          /final status/,
        );
      },
    );

    it('refuses a no-op transition', async () => {
      await expect(
        move(ParcelStatus.IN_TRANSIT, ParcelStatus.IN_TRANSIT),
      ).rejects.toThrow(/already IN_TRANSIT/);
    });
  });

  describe('assignDeliveryPersonnel', () => {
    it('attaches an approved courier', async () => {
      const parcel = buildParcel();
      parcelRepository.findOne.mockResolvedValue(parcel);
      parcelRepository.save.mockResolvedValue(parcel);
      userService.findDeliveryPersonnelOrFail.mockResolvedValue(courier);

      await service.assignDeliveryPersonnel('TRK-TEST', courier.id, admin);

      expect(parcel.deliveryPersonnel).toBe(courier);
    });

    it.each([ParcelStatus.DELIVERED, ParcelStatus.CANCELLED])(
      'refuses a %s parcel',
      async (status) => {
        parcelRepository.findOne.mockResolvedValue(buildParcel({ status }));

        await expect(
          service.assignDeliveryPersonnel('TRK-TEST', courier.id, admin),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('refuses a blocked parcel', async () => {
      parcelRepository.findOne.mockResolvedValue(
        buildParcel({ isBlocked: true }),
      );

      await expect(
        service.assignDeliveryPersonnel('TRK-TEST', courier.id, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('unassignDeliveryPersonnel', () => {
    it('clears the courier but keeps the status', async () => {
      const parcel = buildParcel({ deliveryPersonnel: courier });
      parcelRepository.findOne.mockResolvedValue(parcel);
      parcelRepository.save.mockResolvedValue(parcel);

      await service.unassignDeliveryPersonnel('TRK-TEST', admin);

      expect(parcel.deliveryPersonnel).toBeNull();
      expect(parcel.status).toBe(ParcelStatus.IN_TRANSIT);
    });

    it('refuses when nobody is assigned', async () => {
      parcelRepository.findOne.mockResolvedValue(buildParcel());

      await expect(
        service.unassignDeliveryPersonnel('TRK-TEST', admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reaching DELIVERED', () => {
    const receiver = { id: 'receiver-1', role: Role.RECEIVER } as User;

    it('stamps deliveredAt from a status update', async () => {
      const parcel = buildParcel({ codAmount: 0 });
      parcelRepository.findOne.mockResolvedValue(parcel);

      await service.updateStatus(
        'TRK-TEST',
        { status: ParcelStatus.DELIVERED },
        admin,
      );

      expect(parcel.deliveredAt).toBeInstanceOf(Date);
    });

    it('stamps deliveredAt from a receiver confirmation', async () => {
      const parcel = buildParcel({ codAmount: 0, receiver });
      parcelRepository.findOne.mockResolvedValue(parcel);

      await service.confirmDelivery('TRK-TEST', receiver);

      expect(parcel.status).toBe(ParcelStatus.DELIVERED);
      expect(parcel.deliveredAt).toBeInstanceOf(Date);
    });

    it('refuses a status update while cash is uncollected', async () => {
      parcelRepository.findOne.mockResolvedValue(
        buildParcel({ codAmount: 500, isCodCollected: false }),
      );

      await expect(
        service.updateStatus(
          'TRK-TEST',
          { status: ParcelStatus.DELIVERED },
          admin,
        ),
      ).rejects.toThrow(/cash on delivery/);
    });

    it('refuses a receiver confirmation while cash is uncollected', async () => {
      parcelRepository.findOne.mockResolvedValue(
        buildParcel({ codAmount: 500, isCodCollected: false, receiver }),
      );

      await expect(
        service.confirmDelivery('TRK-TEST', receiver),
      ).rejects.toThrow(/cash on delivery/);
    });

    it('accepts proof that records the cash', async () => {
      const parcel = buildParcel({
        codAmount: 500,
        isCodCollected: false,
        deliveryPersonnel: courier,
        receiverName: 'Jane',
      });
      parcelRepository.findOne.mockResolvedValue(parcel);

      await service.submitDeliveryProof(
        'TRK-TEST',
        { images: ['https://cdn.example.com/a.jpg'], codCollected: true },
        courier,
      );

      expect(parcel.status).toBe(ParcelStatus.DELIVERED);
      expect(parcel.isCodCollected).toBe(true);
      expect(parcel.deliveredAt).toBeInstanceOf(Date);
    });

    it('keeps the original delivery time when proof arrives later', async () => {
      const deliveredAt = new Date('2026-01-01T00:00:00Z');
      const parcel = buildParcel({
        status: ParcelStatus.DELIVERED,
        codAmount: 0,
        deliveredAt,
      });
      parcelRepository.findOne.mockResolvedValue(parcel);

      await service.submitDeliveryProof(
        'TRK-TEST',
        { images: ['https://cdn.example.com/a.jpg'] },
        admin,
      );

      expect(parcel.deliveredAt).toBe(deliveredAt);
    });
  });

  describe('blocked parcels', () => {
    const sender = { id: 'sender-1', role: Role.SENDER } as User;
    const receiver = { id: 'receiver-1', role: Role.RECEIVER } as User;

    it('cannot be cancelled', async () => {
      parcelRepository.findOne.mockResolvedValue(
        buildParcel({ isBlocked: true, status: ParcelStatus.PENDING, sender }),
      );

      await expect(service.cancelParcel('TRK-TEST', sender)).rejects.toThrow(
        'Parcel is blocked',
      );
    });

    it('cannot be confirmed', async () => {
      parcelRepository.findOne.mockResolvedValue(
        buildParcel({ isBlocked: true, receiver }),
      );

      await expect(
        service.confirmDelivery('TRK-TEST', receiver),
      ).rejects.toThrow('Parcel is blocked');
    });

    it('cannot have proof submitted', async () => {
      parcelRepository.findOne.mockResolvedValue(
        buildParcel({ isBlocked: true }),
      );

      await expect(
        service.submitDeliveryProof(
          'TRK-TEST',
          { images: ['https://cdn.example.com/a.jpg'] },
          admin,
        ),
      ).rejects.toThrow('Parcel is blocked');
    });

    it('can be unblocked, and then moves again', async () => {
      const parcel = buildParcel({ isBlocked: true });
      parcelRepository.findOne.mockResolvedValue(parcel);

      await service.unblockParcel('TRK-TEST', admin);

      expect(parcel.isBlocked).toBe(false);
    });

    it('refuses to unblock a parcel that is not blocked', async () => {
      parcelRepository.findOne.mockResolvedValue(buildParcel());

      await expect(
        service.unblockParcel('TRK-TEST', admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('cancelParcel', () => {
    const sender = { id: 'sender-1', role: Role.SENDER } as User;

    it('lets the sender cancel while PENDING', async () => {
      const parcel = buildParcel({ status: ParcelStatus.PENDING, sender });
      parcelRepository.findOne.mockResolvedValue(parcel);

      await service.cancelParcel('TRK-TEST', sender);

      expect(parcel.status).toBe(ParcelStatus.CANCELLED);
    });

    it.each([
      ParcelStatus.PICKED_UP,
      ParcelStatus.IN_TRANSIT,
      ParcelStatus.OUT_FOR_DELIVERY,
    ])('refuses the sender once the parcel is %s', async (status) => {
      parcelRepository.findOne.mockResolvedValue(
        buildParcel({ status, sender }),
      );

      await expect(service.cancelParcel('TRK-TEST', sender)).rejects.toThrow(
        /already been picked up/,
      );
    });
  });
});
