import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { EmailVerificationService } from '../../auth/services/email-verification.service';
import { SessionService } from '../../auth/services/session.service';
import { MailService } from '../../mail/services/mail.service';
import { TokenService } from '../../token/services/token.service';
import { User } from '../entities/user.entity';
import { IsActive, Role } from '../types/user.types';
import { UserEventsService } from './user-events.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let repository: Record<string, jest.Mock>;
  let sessionService: Record<string, jest.Mock>;
  let auditService: { record: jest.Mock };
  let mailService: { queue: jest.Mock };
  let env: Record<string, string | undefined>;
  let userEvents: UserEventsService;

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-id',
      email: 'user@test.com',
      role: Role.SENDER,
      isDeleted: false,
      isActive: IsActive.ACTIVE,
      ...overrides,
    }) as User;

  beforeEach(async () => {
    repository = {
      exists: jest.fn().mockResolvedValue(false),
      findOne: jest.fn(),
      create: jest.fn((value: Partial<User>) => ({ id: 'new-id', ...value })),
      save: jest.fn((value: User) => Promise.resolve(value)),
      update: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    auditService = { record: jest.fn() };
    mailService = { queue: jest.fn() };
    env = { SUPER_ADMIN_EMAIL: 'root@test.com' };
    sessionService = {
      record: jest.fn(),
      revokeAllForUser: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        UserEventsService,
        { provide: getRepositoryToken(User), useValue: repository },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => env[key]),
            getOrThrow: jest.fn().mockReturnValue('4'),
          },
        },
        {
          provide: TokenService,
          useValue: {
            createUserTokens: jest.fn().mockReturnValue({
              accessToken: 'access',
              refreshToken: 'refresh',
            }),
            refreshTokenExpiresAt: jest.fn().mockReturnValue(new Date()),
          },
        },
        { provide: EmailVerificationService, useValue: { issue: jest.fn() } },
        { provide: SessionService, useValue: sessionService },
        { provide: AuditService, useValue: auditService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userEvents = module.get(UserEventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const payload = {
      name: 'New User',
      email: 'new@test.com',
      password: 'Password123!',
    };

    it('records a session, so the refresh token it returns works', async () => {
      const result = await service.register(payload);

      expect(sessionService.record).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@test.com' }),
        'refresh',
        expect.any(Date),
      );
      expect(result.user).not.toHaveProperty('password');
    });

    it('keeps the lockout bookkeeping out of the response', async () => {
      repository.create.mockImplementation((value: Partial<User>) => ({
        id: 'new-id',
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...value,
      }));

      const result = await service.register(payload);

      expect(result.user).not.toHaveProperty('failedLoginAttempts');
      expect(result.user).not.toHaveProperty('lockedUntil');
    });

    it('defaults to SENDER', async () => {
      const result = await service.register(payload);

      expect(result.user.role).toBe(Role.SENDER);
    });

    it('lets a public signup register as a receiver', async () => {
      const result = await service.register({
        ...payload,
        role: Role.RECEIVER,
      });

      expect(result.user.role).toBe(Role.RECEIVER);
    });

    it('parks a courier signup in PENDING_DELIVERY', async () => {
      const result = await service.register({
        ...payload,
        role: Role.DELIVERY_PERSONNEL,
      });

      expect(result.user.role).toBe(Role.PENDING_DELIVERY);
    });

    it('still refuses ADMIN without an admin token', async () => {
      await expect(
        service.register({ ...payload, role: Role.ADMIN }),
      ).rejects.toThrow(/Authorization token required/);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('setUserActiveStatus', () => {
    const admin = buildUser({ id: 'admin-id', role: Role.ADMIN });

    it('ends sessions and announces it when blocking', async () => {
      repository.findOne.mockResolvedValue(buildUser());
      const announced = jest.fn();
      userEvents.accessRevoked$.subscribe(announced);

      const result = await service.setUserActiveStatus('user-id', false, admin);

      expect(result.isActive).toBe(IsActive.BLOCKED);
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith('user-id');
      expect(announced).toHaveBeenCalledWith('user-id');
    });

    it('refuses to let an admin block themselves', async () => {
      repository.findOne.mockResolvedValue(admin);

      await expect(
        service.setUserActiveStatus('admin-id', false, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to block the super admin', async () => {
      repository.findOne.mockResolvedValue(
        buildUser({ id: 'root-id', email: 'root@test.com', role: Role.ADMIN }),
      );

      await expect(
        service.setUserActiveStatus('root-id', false, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('sign-in lockout', () => {
    it('counts a wrong password', async () => {
      await service.recordFailedLogin(buildUser({ failedLoginAttempts: 2 }));

      expect(repository.update).toHaveBeenCalledWith('user-id', {
        failedLoginAttempts: 3,
      });
    });

    it('locks the account on the fifth, and restarts the count', async () => {
      const before = Date.now();

      await service.recordFailedLogin(buildUser({ failedLoginAttempts: 4 }));

      const [, changes] = repository.update.mock.calls[0] as [
        string,
        { failedLoginAttempts: number; lockedUntil: Date },
      ];
      expect(changes.failedLoginAttempts).toBe(0);
      const minutes = (changes.lockedUntil.getTime() - before) / 60_000;
      expect(minutes).toBeGreaterThan(14.9);
      expect(minutes).toBeLessThan(15.1);
    });

    it('reports how long a lock has left', () => {
      const locked = buildUser({ lockedUntil: new Date(Date.now() + 60_000) });

      expect(service.lockRemainingMs(locked)).toBeGreaterThan(59_000);
      expect(service.lockRemainingMs(buildUser({ lockedUntil: null }))).toBe(0);
      expect(
        service.lockRemainingMs(
          buildUser({ lockedUntil: new Date(Date.now() - 1) }),
        ),
      ).toBe(0);
    });

    it('wipes the slate after a good sign-in', async () => {
      await service.clearFailedLogins(buildUser({ failedLoginAttempts: 3 }));

      expect(repository.update).toHaveBeenCalledWith('user-id', {
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
    });

    it('writes nothing when there is nothing to wipe', async () => {
      await service.clearFailedLogins(
        buildUser({ failedLoginAttempts: 0, lockedUntil: null }),
      );

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('setDeliveryApproval', () => {
    const admin = buildUser({ id: 'admin-id', role: Role.ADMIN });
    const applicant = (overrides: Partial<User> = {}) =>
      buildUser({
        name: 'Cal Courier',
        role: Role.PENDING_DELIVERY,
        nidNumber: '1990123456789',
        nidImage: ['https://cdn.example.com/nid.png'],
        ...overrides,
      });

    it('approves a complete application and tells the applicant', async () => {
      repository.findOne.mockResolvedValue(applicant());

      const result = await service.setDeliveryApproval('user-id', true, admin);

      expect(result.role).toBe(Role.DELIVERY_PERSONNEL);
      expect(mailService.queue).toHaveBeenCalledWith(
        'user@test.com',
        expect.stringContaining('approved'),
        expect.any(String),
        expect.any(String),
      );
    });

    it.each<[string, Partial<User>]>([
      ['no ID number', { nidNumber: undefined }],
      ['no photo of the ID', { nidImage: [] }],
    ])('refuses to approve an application with %s', async (_label, missing) => {
      repository.findOne.mockResolvedValue(applicant(missing));

      await expect(
        service.setDeliveryApproval('user-id', true, admin),
      ).rejects.toThrow(/national ID/);
      expect(repository.save).not.toHaveBeenCalled();
      expect(mailService.queue).not.toHaveBeenCalled();
    });

    it('rejects without needing the ID, and still tells the applicant', async () => {
      repository.findOne.mockResolvedValue(
        applicant({ nidNumber: undefined, nidImage: [] }),
      );

      const result = await service.setDeliveryApproval('user-id', false, admin);

      expect(result.role).toBe(Role.SENDER);
      expect(mailService.queue).toHaveBeenCalledWith(
        'user@test.com',
        expect.stringContaining('update'),
        expect.any(String),
        expect.any(String),
      );
    });

    it('wants a confirmed email too, when the server requires one', async () => {
      env.REQUIRE_VERIFIED_EMAIL = 'true';
      repository.findOne.mockResolvedValue(applicant({ isVerified: false }));

      await expect(
        service.setDeliveryApproval('user-id', true, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('assertEmailVerified', () => {
    const unverified = buildUser({ isVerified: false });

    it('lets everyone through by default', () => {
      expect(() =>
        service.assertEmailVerified(unverified, 'booking a parcel'),
      ).not.toThrow();
    });

    it('refuses an unconfirmed account once the server requires it', () => {
      env.REQUIRE_VERIFIED_EMAIL = 'true';

      expect(() =>
        service.assertEmailVerified(unverified, 'booking a parcel'),
      ).toThrow(/Confirm your email address before booking a parcel/);
      expect(() =>
        service.assertEmailVerified(
          buildUser({ isVerified: true }),
          'booking a parcel',
        ),
      ).not.toThrow();
    });
  });

  describe('adminUpdateUser', () => {
    const admin = buildUser({ id: 'admin-id', role: Role.ADMIN });

    it('changes what was sent and records exactly that', async () => {
      repository.findOne.mockResolvedValue(
        buildUser({ name: 'Old Name', phone: '+8801700000000' }),
      );

      const result = await service.adminUpdateUser(
        'user-id',
        { name: 'New Name', phone: '+8801700000000' },
        admin,
      );

      expect(result.name).toBe('New Name');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_UPDATED',
          metadata: { name: { from: 'Old Name', to: 'New Name' } },
        }),
      );
    });

    it('writes nothing when nothing actually changes', async () => {
      repository.findOne.mockResolvedValue(buildUser({ name: 'Same' }));

      await service.adminUpdateUser('user-id', { name: 'Same' }, admin);

      expect(repository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('refuses to let an admin change their own role', async () => {
      repository.findOne.mockResolvedValue(admin);

      await expect(
        service.adminUpdateUser('admin-id', { role: Role.SENDER }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to demote the super admin', async () => {
      repository.findOne.mockResolvedValue(
        buildUser({ id: 'root-id', email: 'root@test.com', role: Role.ADMIN }),
      );

      await expect(
        service.adminUpdateUser('root-id', { role: Role.SENDER }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('deleting an account', () => {
    const admin = buildUser({ id: 'admin-id', role: Role.ADMIN });

    it('needs the password before a user can delete themselves', async () => {
      const user = buildUser({ password: '' });

      await expect(
        service.deleteOwnAccount(user, 'guess'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('soft-deletes, ends every session and drops the sockets', async () => {
      const target = buildUser();
      repository.findOne.mockResolvedValue(target);
      const announced = jest.fn();
      userEvents.accessRevoked$.subscribe(announced);

      await service.adminDeleteUser('user-id', admin);

      expect(target.isDeleted).toBe(true);
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        'user-id',
        'security',
      );
      expect(announced).toHaveBeenCalledWith('user-id');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_DELETED' }),
      );
    });

    it('sends an admin to their profile to delete themselves', async () => {
      await expect(
        service.adminDeleteUser('admin-id', admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never deletes the super admin', async () => {
      repository.findOne.mockResolvedValue(
        buildUser({ id: 'root-id', email: 'root@test.com', role: Role.ADMIN }),
      );

      await expect(
        service.adminDeleteUser('root-id', admin),
      ).rejects.toThrow(/super admin/);
    });
  });

  describe('findOrCreateReceiver', () => {
    it('refuses an address owned by a deleted account', async () => {
      repository.findOne.mockResolvedValue(buildUser({ isDeleted: true }));

      await expect(
        service.findOrCreateReceiver({ name: 'Jane', email: 'user@test.com' }),
      ).rejects.toThrow(/not available/);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('getSignInBlockReason', () => {
    it('allows an active user', () => {
      expect(service.getSignInBlockReason(buildUser({}))).toBeNull();
    });

    it('blocks a deleted user', () => {
      expect(service.getSignInBlockReason(buildUser({ isDeleted: true }))).toBe(
        'User is deleted',
      );
    });

    it('blocks a blocked user', () => {
      expect(
        service.getSignInBlockReason(buildUser({ isActive: IsActive.BLOCKED })),
      ).toBe('User is BLOCKED');
    });
  });
});
