import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageResponse } from '../../auth/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated, paginate } from '../../common/types/paginated.type';
import { MailService } from '../../mail/services/mail.service';
import { escapeHtml } from '../../mail/templates/layout.template';
import {
  ContactTopic,
  CreateContactMessageDto,
} from '../dto/create-contact-message.dto';
import { ContactMessage } from '../entities/contact-message.entity';

const TOPIC_LABELS: Record<ContactTopic, string> = {
  sending: 'Sending a parcel',
  tracking: 'A delivery in progress',
  courier: 'Becoming a courier',
  other: 'Something else',
};

const THANKS: MessageResponse = {
  message: 'Thanks — your message has been sent.',
};

/** Sole owner of the `contact_messages` table. */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectRepository(ContactMessage)
    private readonly repository: Repository<ContactMessage>,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Stores a contact-form message and forwards it to the support inbox.
   *
   * The row is the record; the email is queued behind the response, so a mail
   * outage neither loses the message nor shows the visitor an error.
   */
  async submit(payload: CreateContactMessageDto): Promise<MessageResponse> {
    // The form hides this field from people, so only a script fills it in.
    // It is told it succeeded: a bot that sees an error just tries again
    // without the field.
    if (payload.website) {
      this.logger.warn(`Dropped a contact-form submission from a bot`);
      return THANKS;
    }

    await this.repository.save(
      this.repository.create({
        name: payload.name,
        email: payload.email,
        topic: payload.topic,
        trackingId: payload.trackingId ?? null,
        message: payload.message,
      }),
    );

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

    // The message is user-supplied and lands in an HTML email.
    const html = `
      <p><strong>From:</strong> ${escapeHtml(payload.name)} &lt;${escapeHtml(payload.email)}&gt;</p>
      <p><strong>Topic:</strong> ${escapeHtml(topic)}</p>
      ${payload.trackingId ? `<p><strong>Tracking ID:</strong> ${escapeHtml(payload.trackingId)}</p>` : ''}
      <p style="white-space:pre-wrap">${escapeHtml(payload.message)}</p>
    `;

    this.mail.queue(
      inbox,
      `Contact form: ${topic} — ${payload.name}`,
      html,
      lines.join('\n'),
      // So support can answer by hitting reply, instead of writing back to
      // the address the API itself sends from.
      { replyTo: payload.email },
    );

    return THANKS;
  }

  async list(query: PaginationQueryDto): Promise<Paginated<ContactMessage>> {
    const [rows, total] = await this.repository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });

    return paginate(rows, total, query.page, query.limit);
  }
}
