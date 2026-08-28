import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../../user/entities/user.entity';
import { UserService } from '../../user/services/user.service';
import { TokenService } from '../../token/services/token.service';
import { IsActive, Role } from '../../user/types/user.types';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';

describe('AuthService', () => {
  let service: AuthService;
  let userService: Record<string, jest.Mock>;
  let sessionService: Record<string, jest.Mock>;
  let passwordResetService: Record<string, jest.Mock>;
  let emailVerificationService: Record<string, jest.Mock>;

  const user = {
    id: 'user-1',
    email: 'jane@example.com',
    name: 'Jane',
    password: 'hashed',
    role: Role.SENDER,
    isActive: IsActive.ACTIVE,
    isDeleted: false,
    isVerified: false,
  } as User;

  const pair = { accessToken: 'access', refreshToken: 'refresh' };

  beforeEach(async () => {
    userService = {
      findByEmail: jest.fn().mockResolvedValue(user),
      verifyPassword: jest.fn().mockResolvedValue(true),
      getSignInBlockReason: jest.fn().mockReturnValue(null),
      setPassword: jest.fn(),
      markVerified: jest.fn(),
    };
    const tokenService = {
      createUserTokens: jest.fn().mockReturnValue(pair),
      verifyRefreshToken: jest.fn().mockReturnValue({ email: user.email }),
      signAccessToken: jest.fn().mockReturnValue('access'),
    };
    sessionService = {
      record: jest.fn(),
      assertActive: jest.fn(),
      revoke: jest.fn().mockResolvedValue(true),
      revokeAllForUser: jest.fn().mockResolvedValue(2),
    };
    passwordResetService = {
      issue: jest.fn(),
      consume: jest.fn().mockResolvedValue({ user }),
    };
    emailVerificationService = {
      issue: jest.fn(),
      consume: jest.fn().mockResolvedValue(user),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: TokenService, useValue: tokenService },
        { provide: SessionService, useValue: sessionService },
        { provide: PasswordResetService, useValue: passwordResetService },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationService,
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('7d') },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('records the session it just issued', async () => {
      const result = await service.login({
        email: user.email,
        password: 'pw',
      });

      expect(result.accessToken).toBe('access');
      expect(sessionService.record).toHaveBeenCalledWith(
        user,
        'refresh',
        expect.any(Date),
      );
    });

    it('never says which half of the credentials was wrong', async () => {
      userService.verifyPassword.mockResolvedValue(false);

      await expect(
        service.login({ email: user.email, password: 'nope' }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('gives the same message for an unknown address', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@x.com', password: 'pw' }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('refuses a blocked account', async () => {
      userService.getSignInBlockReason.mockReturnValue('User is BLOCKED');

      await expect(
        service.login({ email: user.email, password: 'pw' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('strips the password from the returned user', async () => {
      const result = await service.login({ email: user.email, password: 'pw' });

      expect(result.user).not.toHaveProperty('password');
    });
  });

  describe('refreshAccessToken', () => {
    it('rotates: revokes the old token and records the new one', async () => {
      const result = await service.refreshAccessToken('old-refresh');

      expect(sessionService.assertActive).toHaveBeenCalledWith('old-refresh');
      expect(sessionService.revoke).toHaveBeenCalledWith('old-refresh');
      expect(sessionService.record).toHaveBeenCalledWith(
        user,
        'refresh',
        expect.any(Date),
      );
      expect(result).toEqual(pair);
    });

    it('refuses a token whose session has ended', async () => {
      sessionService.assertActive.mockRejectedValue(
        new UnauthorizedException('Session has ended'),
      );

      await expect(
        service.refreshAccessToken('dead-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('ends one session when given a token', async () => {
      const result = await service.logout(user, 'refresh');

      expect(sessionService.revoke).toHaveBeenCalledWith('refresh');
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
      expect(result.message).toBe('Logged out successfully');
    });

    it('ends every session when given none', async () => {
      const result = await service.logout(user);

      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(user.id);
      expect(result.message).toContain('2 devices');
    });
  });

  describe('forgotPassword', () => {
    it('issues a grant for a real account', async () => {
      await service.forgotPassword(user.email);

      expect(passwordResetService.issue).toHaveBeenCalledWith(user);
    });

    it('says the same thing for an unknown address', async () => {
      const known = await service.forgotPassword(user.email);
      userService.findByEmail.mockResolvedValue(null);
      const unknown = await service.forgotPassword('nobody@x.com');

      expect(unknown.message).toBe(known.message);
      expect(passwordResetService.issue).toHaveBeenCalledTimes(1);
    });

    it('does not issue a grant for a blocked account', async () => {
      userService.getSignInBlockReason.mockReturnValue('User is BLOCKED');

      await service.forgotPassword(user.email);

      expect(passwordResetService.issue).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('sets the password and ends every session', async () => {
      await service.resetPassword('a'.repeat(64), 'NewPassw0rd!');

      expect(userService.setPassword).toHaveBeenCalledWith(
        user,
        'NewPassw0rd!',
      );
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(user.id);
    });
  });

  describe('changePassword', () => {
    it('rejects a wrong current password', async () => {
      userService.verifyPassword.mockResolvedValue(false);

      await expect(
        service.changePassword(user, {
          currentPassword: 'wrong',
          newPassword: 'NewPassw0rd!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userService.setPassword).not.toHaveBeenCalled();
    });

    it('ends every session on success', async () => {
      await service.changePassword(user, {
        currentPassword: 'pw',
        newPassword: 'NewPassw0rd!',
      });

      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(user.id);
    });

    it('refuses an account with no password set', async () => {
      await expect(
        service.changePassword({ ...user, password: '' } as User, {
          currentPassword: 'pw',
          newPassword: 'NewPassw0rd!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    it('consumes the grant and flips the flag', async () => {
      await service.verifyEmail('b'.repeat(64));

      expect(userService.markVerified).toHaveBeenCalledWith(user.id);
    });
  });

  describe('resendVerification', () => {
    it('says the same thing whether or not the account exists', async () => {
      const known = await service.resendVerification(user.email);
      userService.findByEmail.mockResolvedValue(null);
      const unknown = await service.resendVerification('nobody@x.com');

      expect(unknown.message).toBe(known.message);
    });

    it('does not reissue for an already-verified account', async () => {
      userService.findByEmail.mockResolvedValue({
        ...user,
        isVerified: true,
      } as User);

      await service.resendVerification(user.email);

      expect(emailVerificationService.issue).not.toHaveBeenCalled();
    });
  });
});
