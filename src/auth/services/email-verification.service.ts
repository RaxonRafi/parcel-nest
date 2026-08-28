import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectRepository(EmailVerification)
    private readonly repository: Repository<EmailVerification>,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Issues a grant and emails it. Never throws — see the catch below. */
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

    try {
      await this.mailService.send(user.email, subject, html, text);
    } catch (error) {
      // Registration must not fail because the mail server is down; the user
      // can ask for another link from `resend-verification`.
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Verification email to ${user.email} could not be sent: ${message}`,
      );
    }
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

    grant.usedAt = new Date();
    await this.repository.save(grant);

    return grant.user;
  }

  async pruneExpired(): Promise<number> {
    const result = await this.repository.delete({
      expiresAt: LessThan(new Date()),
    });

    return result.affected ?? 0;
  }
}
