import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageResponse } from '../../auth/types/auth.types';
import { MailService } from '../../mail/services/mail.service';
import {
  ContactTopic,
  CreateContactMessageDto,
} from '../dto/create-contact-message.dto';

const TOPIC_LABELS: Record<ContactTopic, string> = {
  sending: 'Sending a parcel',
  tracking: 'A delivery in progress',
  courier: 'Becoming a courier',
  other: 'Something else',
};

/** The message is user-supplied and lands in an HTML email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Injectable()
export class ContactService {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Forwards a contact-form message to the support inbox. Nothing is stored:
   * the email is the record. Without SMTP configured, MailService logs the
   * message instead, so the form still works in development.
   */
  async submit(payload: CreateContactMessageDto): Promise<MessageResponse> {
    const inbox =
      this.config.get<string>('SUPPORT_EMAIL') ??
      this.config.get<string>('SMTP_FROM') ??
      this.config.get<string>('SMTP_USER') ??
      'support@parcel.app';

    const topic = TOPIC_LABELS[payload.topic];
    const lines = [
      `From: ${payload.name} <${payload.email}>`,
      `Topic: ${topic}`,
      ...(payload.trackingId ? [`Tracking ID: ${payload.trackingId}`] : []),
      '',
      payload.message,
    ];

    const html = `
      <p><strong>From:</strong> ${escapeHtml(payload.name)} &lt;${escapeHtml(payload.email)}&gt;</p>
      <p><strong>Topic:</strong> ${escapeHtml(topic)}</p>
      ${payload.trackingId ? `<p><strong>Tracking ID:</strong> ${escapeHtml(payload.trackingId)}</p>` : ''}
      <p style="white-space:pre-wrap">${escapeHtml(payload.message)}</p>
    `;

    await this.mail.send(
      inbox,
      `Contact form: ${topic} — ${payload.name}`,
      html,
      lines.join('\n'),
    );

    return { message: 'Thanks — your message has been sent.' };
  }
}
