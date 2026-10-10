import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
      this.tokenService.refreshTokenExpiresAt(),
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
      throw new UnauthorizedException('Session has ended — sign in again');
    }

    this.assertCanSignIn(user);

    // The revoke is the claim: of two requests racing with the same token
    // only one gets `true`, so a refresh token is never exchanged twice.
    if (!(await this.sessionService.revoke(refreshToken))) {
      throw new UnauthorizedException('Session has ended — sign in again');
    }

    const tokens = this.tokenService.createUserTokens(user);
    await this.sessionService.record(
      user,
      tokens.refreshToken,
      this.tokenService.refreshTokenExpiresAt(),
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
      // Scoped to the caller: the token comes from the body, not the header.
      await this.sessionService.revoke(refreshToken, user.id);
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
    // The link only reaches whoever reads that inbox, so opening it proves
    // the address just as a confirmation link would. This is also how a
    // receiver claiming a placeholder account ends up verified.
    if (!grant.user.isVerified) {
      await this.userService.markVerified(grant.user.id);
    }
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

  /** 401, matching what `JwtAuthGuard` answers for the same account. */
  private assertCanSignIn(user: User): void {
    const blockReason = this.userService.getSignInBlockReason(user);

    if (blockReason) {
      throw new UnauthorizedException(blockReason);
    }
  }
}
