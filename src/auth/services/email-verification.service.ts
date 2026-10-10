import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { MailService } from '../../mail/services/mail.service';
import { verifyEmailTemplate } from '../../mail/templates/account.template';
import { webBaseUrl } from '../../common/utils/web-url.util';
import { User } from '../../user/entities/user.entity';
import { EmailVerification } from '../entities/email-verification.entity';
import { hashToken } from './session.service';

const EXPIRY_HOURS = 24;

/** Sole owner of the `email_verifications` table. */
@Injectable()
export class EmailVerificationService {
  constructor(
    @InjectRepository(EmailVerification)
    private readonly repository: Repository<EmailVerification>,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Issues a grant and queues its email. A mail outage cannot fail it. */
  async issue(user: User): Promise<void> {
    if (user.isVerified) {
      return;
    }

    await this.repository.update(
      { user: { id: user.id }, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    const token = randomBytes(32).toString('hex');
    await this.repository.save(
      this.repository.create({
        user,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EXPIRY_HOURS * 3_600_000),
        usedAt: null,
      }),
    );

    const url = `${webBaseUrl(this.config)}/verify-email?token=${token}`;
    const { subject, html, text } = verifyEmailTemplate(
      user.name,
      url,
      EXPIRY_HOURS,
    );

    // Registration must not fail, or wait, because the mail server is slow or
    // down; the user can ask for another link from `resend-verification`.
    this.mailService.queue(user.email, subject, html, text);
  }

  /** Spends a grant and returns the user it belonged to. */
  async consume(token: string): Promise<User> {
    const grant = await this.repository.findOne({
      where: { tokenHash: hashToken(token), usedAt: IsNull() },
      relations: ['user'],
    });

    if (!grant || grant.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This confirmation link is invalid or has expired — request a new one',
      );
    }

    // Conditional on still being unused, so a link opened twice at once is
    // spent exactly once.
    const claimed = await this.repository.update(
      { id: grant.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    if (!claimed.affected) {
      throw new BadRequestException(
        'This confirmation link is invalid or has expired — request a new one',
      );
    }

    return grant.user;
  }

  async pruneExpired(): Promise<number> {
    const result = await this.repository.delete({
      expiresAt: LessThan(new Date()),
    });

    return result.affected ?? 0;
  }
}
