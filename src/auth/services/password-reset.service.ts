import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { MailService } from '../../mail/services/mail.service';
import { claimAccountTemplate } from '../../mail/templates/account.template';
import { passwordResetEmail } from '../../mail/templates/password-reset.template';
import { webBaseUrl } from '../../common/utils/web-url.util';
import { User } from '../../user/entities/user.entity';
import { PasswordReset } from '../entities/password-reset.entity';
import { hashToken } from './session.service';

const EXPIRY_MINUTES = 30;

/**
 * A claim link is not something the receiver asked for, so it cannot assume
 * they are at their inbox: it has to survive until they next read their mail.
 */
const CLAIM_EXPIRY_DAYS = 7;

/** Sole owner of the `password_resets` table. */
@Injectable()
export class PasswordResetService {
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
    const token = await this.createGrant(user, EXPIRY_MINUTES);
    const url = `${webBaseUrl(this.config)}/reset-password?token=${token}`;
    const { html, text } = passwordResetEmail(user.name, url, EXPIRY_MINUTES);

    // Queued, so a delivery failure can neither fail nor slow the request.
    // That matters twice over here: if `forgot-password` answered 500 (or
    // just more slowly) for registered addresses while unknown ones returned
    // 200 at once, it would hand back exactly the account-enumeration signal
    // the generic response exists to hide. Operators find failures in the logs.
    this.mailService.queue(
      user.email,
      'Reset your Parcel Delivery password',
      html,
      text,
    );
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
    const token = await this.createGrant(user, CLAIM_EXPIRY_DAYS * 24 * 60);
    const url = `${webBaseUrl(this.config)}/reset-password?token=${token}`;
    const { subject, html, text } = claimAccountTemplate(
      user.name,
      senderName,
      trackingId,
      url,
      `${CLAIM_EXPIRY_DAYS} days`,
    );

    this.mailService.queue(user.email, subject, html, text);
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

    // Conditional on still being unused, so a link opened twice at once is
    // spent exactly once.
    const claimed = await this.resetRepository.update(
      { id: grant.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    if (!claimed.affected) {
      throw new BadRequestException(
        'This reset link is invalid or has expired — request a new one',
      );
    }

    return grant;
  }

  async pruneExpired(): Promise<number> {
    const result = await this.resetRepository.delete({
      expiresAt: LessThan(new Date()),
    });

    return result.affected ?? 0;
  }

  /** Spends any outstanding grant, then mints a fresh one. */
  private async createGrant(
    user: User,
    expiryMinutes: number,
  ): Promise<string> {
    await this.spendAllForUser(user.id);

    const token = randomBytes(32).toString('hex');
    await this.resetRepository.save(
      this.resetRepository.create({
        user,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + expiryMinutes * 60_000),
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
}
