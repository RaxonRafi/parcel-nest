import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RagService } from '../../rag/services/rag.service';
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
    parcelRepository = { findOne: jest.fn(), save: jest.fn(), find: jest.fn() };
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
});
