import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
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
      lockRemainingMs: jest.fn().mockReturnValue(0),
      recordFailedLogin: jest.fn(),
      clearFailedLogins: jest.fn(),
    };
    const tokenService = {
      createUserTokens: jest.fn().mockReturnValue(pair),
      verifyRefreshToken: jest.fn().mockReturnValue({ email: user.email }),
      signAccessToken: jest.fn().mockReturnValue('access'),
      refreshTokenExpiresAt: jest.fn().mockReturnValue(new Date()),
    };
    sessionService = {
      record: jest.fn(),
      assertActive: jest
        .fn()
        .mockResolvedValue({ id: 'row-1', familyId: 'family-1' }),
      revoke: jest.fn().mockResolvedValue(true),
      revokeAllForUser: jest.fn().mockResolvedValue(2),
      listForUser: jest.fn().mockResolvedValue([]),
      revokeById: jest.fn(),
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
        {},
      );
    });

    it('remembers which device signed in', async () => {
      const context = { userAgent: 'Firefox', ip: '203.0.113.7' };

      await service.login({ email: user.email, password: 'pw' }, context);

      expect(sessionService.record).toHaveBeenCalledWith(
        user,
        'refresh',
        expect.any(Date),
        context,
      );
    });

    it('counts a wrong password against the account', async () => {
      userService.verifyPassword.mockResolvedValue(false);

      await expect(
        service.login({ email: user.email, password: 'nope' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userService.recordFailedLogin).toHaveBeenCalledWith(user);
    });

    it('has nothing to count for an unknown address', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@x.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userService.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('refuses a locked account before looking at the password', async () => {
      userService.lockRemainingMs.mockReturnValue(9 * 60_000 + 1);

      const attempt = service.login({ email: user.email, password: 'pw' });

      await expect(attempt).rejects.toBeInstanceOf(HttpException);
      await expect(attempt).rejects.toMatchObject({ status: 429 });
      await expect(attempt).rejects.toThrow(/10 minutes/);
      // The right password must not get through, nor extend the lock.
      expect(userService.verifyPassword).not.toHaveBeenCalled();
      expect(userService.recordFailedLogin).not.toHaveBeenCalled();
      expect(sessionService.record).not.toHaveBeenCalled();
    });

    it('wipes the failed-attempt count on success', async () => {
      await service.login({ email: user.email, password: 'pw' });

      expect(userService.clearFailedLogins).toHaveBeenCalledWith(user);
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

    it('refuses a blocked account with the same 401 the guard gives', async () => {
      userService.getSignInBlockReason.mockReturnValue('User is BLOCKED');

      await expect(
        service.login({ email: user.email, password: 'pw' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
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
      // Marked as a rotation, which is what makes a later reuse detectable.
      expect(sessionService.revoke).toHaveBeenCalledWith(
        'old-refresh',
        undefined,
        'rotated',
      );
      expect(sessionService.record).toHaveBeenCalledWith(
        user,
        'refresh',
        expect.any(Date),
        // The new token stays in the family of the one it replaced.
        { familyId: 'family-1' },
      );
      expect(result).toEqual(pair);
    });

    it('roots the family at a token from before families existed', async () => {
      sessionService.assertActive.mockResolvedValue({
        id: 'legacy-row',
        familyId: null,
      });

      await service.refreshAccessToken('old-refresh');

      expect(sessionService.record).toHaveBeenCalledWith(
        user,
        'refresh',
        expect.any(Date),
        { familyId: 'legacy-row' },
      );
    });

    it('refuses the loser when one token is exchanged twice at once', async () => {
      // Both requests pass `assertActive`; only one wins the revoke.
      sessionService.revoke.mockResolvedValue(false);

      await expect(
        service.refreshAccessToken('old-refresh'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessionService.record).not.toHaveBeenCalled();
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

      // Scoped to the caller, so one user cannot end another's session.
      expect(sessionService.revoke).toHaveBeenCalledWith('refresh', user.id);
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
      expect(result.message).toBe('Logged out successfully');
    });

    it('ends every session when given none', async () => {
      const result = await service.logout(user);

      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(user.id);
      expect(result.message).toContain('2 devices');
    });
  });

  describe('sessions', () => {
    it("lists the caller's own devices", async () => {
      await service.listSessions(user, 'cookie-token');

      expect(sessionService.listForUser).toHaveBeenCalledWith(
        user.id,
        'cookie-token',
      );
    });

    it('signs one device out, scoped to the caller', async () => {
      await service.endSession(user, 'row-7');

      expect(sessionService.revokeById).toHaveBeenCalledWith('row-7', user.id);
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
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        user.id,
        'security',
      );
    });

    it('lifts a sign-in lock — the owner has proved who they are', async () => {
      await service.resetPassword('a'.repeat(64), 'NewPassw0rd!');

      expect(userService.clearFailedLogins).toHaveBeenCalledWith(user);
    });

    it('marks the address verified — the link proved it', async () => {
      await service.resetPassword('a'.repeat(64), 'NewPassw0rd!');

      expect(userService.markVerified).toHaveBeenCalledWith(user.id);
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

      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        user.id,
        'security',
      );
    });

    it('refuses an account with no password set', async () => {
      await expect(
        service.changePassword(
          { ...user, password: '' },
          {
            currentPassword: 'pw',
            newPassword: 'NewPassw0rd!',
          },
        ),
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
      });

      await service.resendVerification(user.email);

      expect(emailVerificationService.issue).not.toHaveBeenCalled();
    });
  });
});
