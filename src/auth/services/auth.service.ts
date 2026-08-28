import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenService } from '../../token/services/token.service';
import { User } from '../../user/entities/user.entity';
import { UserService } from '../../user/services/user.service';
import { sanitizeUser } from '../../user/utils/sanitize-user.util';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { LoginDto } from '../dto/login.dto';
import { AuthResponse, MessageResponse } from '../types/auth.types';
import { TokenPair } from '../../token/types/token.types';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';

/**
 * Session concerns only. All user reads/writes go through `UserService`, and
 * all signing goes through `TokenService` — this service owns no repository.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly passwordResetService: PasswordResetService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly config: ConfigService,
  ) {}

  async login(payload: LoginDto): Promise<AuthResponse> {
    const user = await this.userService.findByEmail(payload.email);

    if (
      !user ||
      !(await this.userService.verifyPassword(user, payload.password))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertCanSignIn(user);

    const tokens = this.tokenService.createUserTokens(user);
    await this.sessionService.record(
      user,
      tokens.refreshToken,
      this.refreshExpiryDate(),
    );

    return { user: sanitizeUser(user), ...tokens };
  }

  /**
   * Rotates the pair: the presented refresh token is revoked and a fresh one
   * issued, so a stolen token is usable at most once before the real user's
   * next refresh invalidates it.
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    await this.sessionService.assertActive(refreshToken);

    const user = await this.userService.findByEmail(payload.email);

    if (!user) {
      throw new BadRequestException('User does not exist');
    }

    this.assertCanSignIn(user);

    const tokens = this.tokenService.createUserTokens(user);
    await this.sessionService.revoke(refreshToken);
    await this.sessionService.record(
      user,
      tokens.refreshToken,
      this.refreshExpiryDate(),
    );

    return tokens;
  }

  /**
   * Ends one session when a refresh token is supplied, every session when it
   * is not. The access token stays valid until it expires — at a 15 minute
   * TTL that is the residual window, and the price of stateless access tokens.
   */
  async logout(user: User, refreshToken?: string): Promise<MessageResponse> {
    if (refreshToken) {
      await this.sessionService.revoke(refreshToken);
      return { message: 'Logged out successfully' };
    }

    const ended = await this.sessionService.revokeAllForUser(user.id);
    return {
      message: `Logged out of ${ended} device${ended === 1 ? '' : 's'}`,
    };
  }

  /**
   * Always reports success. Telling an anonymous caller whether an address is
   * registered turns this endpoint into an account-enumeration oracle.
   */
  async forgotPassword(email: string): Promise<MessageResponse> {
    const user = await this.userService.findByEmail(email);

    if (user && !this.userService.getSignInBlockReason(user)) {
      await this.passwordResetService.issue(user);
    }

    return {
      message: 'If that email has an account, a reset link is on its way to it',
    };
  }

  /** Consumes a reset grant, sets the new password, and ends every session. */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<MessageResponse> {
    const grant = await this.passwordResetService.consume(token);

    await this.userService.setPassword(grant.user, newPassword);
    // Whoever prompted the reset may be holding a token; end all of them.
    await this.sessionService.revokeAllForUser(grant.user.id);

    return { message: 'Password reset — sign in with your new password' };
  }

  /** Confirms an address and flips `isVerified`. */
  async verifyEmail(token: string): Promise<MessageResponse> {
    const user = await this.emailVerificationService.consume(token);
    await this.userService.markVerified(user.id);

    return { message: 'Email confirmed' };
  }

  /** Like `forgot-password`, this never reveals whether the address exists. */
  async resendVerification(email: string): Promise<MessageResponse> {
    const user = await this.userService.findByEmail(email);

    if (user && !user.isVerified) {
      await this.emailVerificationService.issue(user);
    }

    return {
      message:
        'If that email has an unconfirmed account, a new link is on its way',
    };
  }

  async changePassword(
    user: User,
    payload: ChangePasswordDto,
  ): Promise<MessageResponse> {
    if (!user.password) {
      throw new BadRequestException(
        'Password change is not available for this account',
      );
    }

    const isCurrentPasswordValid = await this.userService.verifyPassword(
      user,
      payload.currentPassword,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.userService.setPassword(user, payload.newPassword);
    await this.sessionService.revokeAllForUser(user.id);

    return {
      message: 'Password changed successfully — sign in again on your devices',
    };
  }

  /**
   * Mirrors JWT_REFRESH_EXPIRES so the stored row expires with the token it
   * tracks. Supports the `7d` / `12h` / `30m` / `3600` forms jsonwebtoken takes.
   */
  private refreshExpiryDate(): Date {
    const raw = this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES').trim();
    const match = /^(\d+)\s*([smhd])?$/.exec(raw);

    if (!match) {
      throw new Error(`Unsupported JWT_REFRESH_EXPIRES value: ${raw}`);
    }

    const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    const ms = Number(match[1]) * (match[2] ? unitMs[match[2]] : 1_000);

    return new Date(Date.now() + ms);
  }

  private assertCanSignIn(user: User): void {
    const blockReason = this.userService.getSignInBlockReason(user);

    if (blockReason) {
      throw new BadRequestException(blockReason);
    }
  }
}
