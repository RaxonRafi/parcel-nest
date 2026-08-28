import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

/**
 * SMTP delivery. Configuration is optional on purpose: without SMTP_HOST the
 * service logs what it would have sent instead of throwing, so a developer
 * without mail credentials can still exercise the password reset flow.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER');
    // Gmail shows app passwords in spaced groups of four ("abcd efgh ijkl mnop")
    // but rejects them unless the spaces are stripped, which reads as a plain
    // credentials failure. Strip here so a pasted-as-shown value just works.
    const pass = this.config.get<string>('SMTP_PASS')?.replace(/\s+/g, '');

    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP is not configured — emails will be logged, not sent',
      );
      return;
    }

    this.transporter = createTransport({
      host,
      port,
      // 465 is implicit TLS; 587 upgrades with STARTTLS after connecting.
      secure: port === 465,
      auth: { user, pass },
    });

    this.logger.log(`Mail transport ready (${host}:${port})`);
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@parcel.app';

    if (!this.transporter) {
      this.logger.warn(
        `[mail not sent — SMTP unconfigured] to=${to} subject="${subject}"`,
      );
      this.logger.debug(text);
      return;
    }

    await this.transporter.sendMail({ from, to, subject, html, text });
    this.logger.log(`Sent "${subject}" to ${to}`);
  }
}
