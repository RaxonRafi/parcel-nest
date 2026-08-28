import { AuditService } from '../../audit/services/audit.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmailVerificationService } from '../../auth/services/email-verification.service';
import { TokenService } from '../../token/services/token.service';
import { User } from '../entities/user.entity';
import { IsActive, Role } from '../types/user.types';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn() },
        },
        { provide: TokenService, useValue: {} },
        { provide: EmailVerificationService, useValue: { issue: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSignInBlockReason', () => {
    const buildUser = (overrides: Partial<User>): User =>
      ({
        id: 'user-id',
        email: 'user@test.com',
        role: Role.SENDER,
        isDeleted: false,
        isActive: IsActive.ACTIVE,
        ...overrides,
      }) as User;

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
