import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { EmailVerificationService } from '../../auth/services/email-verification.service';
import { SessionService } from '../../auth/services/session.service';
import { TokenService } from '../../token/services/token.service';
import { User } from '../entities/user.entity';
import { IsActive, Role } from '../types/user.types';
import { UserEventsService } from './user-events.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let repository: Record<string, jest.Mock>;
  let sessionService: Record<string, jest.Mock>;
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
    };
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
            get: jest.fn((key: string) =>
              key === 'SUPER_ADMIN_EMAIL' ? 'root@test.com' : undefined,
            ),
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
        { provide: AuditService, useValue: { record: jest.fn() } },
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
