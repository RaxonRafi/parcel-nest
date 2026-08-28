import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { MailService } from '../../mail/services/mail.service';
import { claimAccountTemplate } from '../../mail/templates/account.template';
import { passwordResetEmail } from '../../mail/templates/password-reset.template';
import { User } from '../../user/entities/user.entity';
import { PasswordReset } from '../entities/password-reset.entity';
import { hashToken } from './session.service';

const EXPIRY_MINUTES = 30;

/** Sole owner of the `password_resets` table. */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(PasswordReset)
    private readonly resetRepository: Repository<PasswordReset>,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issues a single-use grant and emails it. Any grant the user already holds
   * is spent first, so requesting a second link invalidates the first.
   */
  async issue(user: User): Promise<void> {
    const token = await this.createGrant(user);
    const url = `${this.webBaseUrl()}/reset-password?token=${token}`;
    const { html, text } = passwordResetEmail(user.name, url, EXPIRY_MINUTES);

    try {
      await this.mailService.send(
        user.email,
        'Reset your Parcel Delivery password',
        html,
        text,
      );
    } catch (error) {
      // Swallowed deliberately. If a delivery failure escaped, `forgot-password`
      // would 500 for registered addresses while unknown ones returned 200 —
      // handing back exactly the account-enumeration signal the generic
      // response exists to hide. Operators find these in the logs instead.
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Password reset email to ${user.email} could not be sent: ${message}`,
      );
    }
  }

  /**
   * Same grant, different framing: a receiver who had an account created for
   * them by a sender never chose a password, so "claim your account" and
   * "reset your password" are the same mechanism.
   */
  async issueClaim(
    user: User,
    senderName: string,
    trackingId: string,
  ): Promise<void> {
    const token = await this.createGrant(user);
    const url = `${this.webBaseUrl()}/reset-password?token=${token}`;
    const { subject, html, text } = claimAccountTemplate(
      user.name,
      senderName,
      trackingId,
      url,
      EXPIRY_MINUTES,
    );

    try {
      await this.mailService.send(user.email, subject, html, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Claim-account email to ${user.email} could not be sent: ${message}`,
      );
    }
  }

  /**
   * Resolves a token to its grant. Throws rather than returning null so the
   * caller cannot forget to check — a wrong token must never reach a write.
   */
  async consume(token: string): Promise<PasswordReset> {
    const grant = await this.resetRepository.findOne({
      where: { tokenHash: hashToken(token), usedAt: IsNull() },
      relations: ['user'],
    });

    if (!grant || grant.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This reset link is invalid or has expired — request a new one',
      );
    }

    grant.usedAt = new Date();
    await this.resetRepository.save(grant);

    return grant;
  }

  async pruneExpired(): Promise<number> {
    const result = await this.resetRepository.delete({
      expiresAt: LessThan(new Date()),
    });

    return result.affected ?? 0;
  }

  /** Spends any outstanding grant, then mints a fresh one. */
  private async createGrant(user: User): Promise<string> {
    await this.spendAllForUser(user.id);

    const token = randomBytes(32).toString('hex');
    await this.resetRepository.save(
      this.resetRepository.create({
        user,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EXPIRY_MINUTES * 60_000),
        usedAt: null,
      }),
    );

    return token;
  }

  private async spendAllForUser(userId: string): Promise<void> {
    await this.resetRepository.update(
      { user: { id: userId }, usedAt: IsNull() },
      { usedAt: new Date() },
    );
  }

  /** Where the reset link points — the frontend, not this API. */
  private webBaseUrl(): string {
    const explicit = this.config.get<string>('FRONTEND_URL');
    if (explicit) return explicit.replace(/\/+$/, '');

    const firstCorsOrigin = this.config
      .get<string>('CORS_ORIGIN')
      ?.split(',')[0]
      ?.trim();

    if (firstCorsOrigin) return firstCorsOrigin.replace(/\/+$/, '');

    this.logger.warn(
      'Neither FRONTEND_URL nor CORS_ORIGIN is set — reset links will point at localhost',
    );
    return 'http://localhost:3001';
  }
}
