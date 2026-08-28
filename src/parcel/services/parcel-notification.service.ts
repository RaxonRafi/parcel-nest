import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { webBaseUrl } from '../../common/utils/web-url.util';
import { MailService } from '../../mail/services/mail.service';
import { parcelStatusEmail } from '../../mail/templates/parcel-status.template';
import { Parcel } from '../entities/parcel.entity';
import { ParcelStatus } from '../types/parcel.types';

/** Statuses worth an email. Intermediate churn would just train people to ignore them. */
const NOTIFIABLE: ParcelStatus[] = [
  ParcelStatus.PICKED_UP,
  ParcelStatus.OUT_FOR_DELIVERY,
  ParcelStatus.DELIVERED,
  ParcelStatus.CANCELLED,
];

/**
 * Parcel emails, fire-and-forget.
 *
 * Every send is caught: a parcel write must not fail because a mail server is
 * unreachable, and the caller has already committed the status change by the
 * time this runs.
 */
@Injectable()
export class ParcelNotificationService {
  private readonly logger = new Logger(ParcelNotificationService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  async notifyStatusChange(parcel: Parcel): Promise<void> {
    if (!NOTIFIABLE.includes(parcel.status)) {
      return;
    }

    const trackingUrl = `${webBaseUrl(this.config)}/track/${parcel.trackingId}`;
    const latestNote = parcel.statusLogs?.[parcel.statusLogs.length - 1]?.note;

    // Both parties care, and they are different people with different names.
    const recipients = [
      { user: parcel.receiver, name: parcel.receiverName },
      { user: parcel.sender, name: parcel.senderName },
    ];

    for (const { user, name } of recipients) {
      if (!user?.email) continue;

      const { subject, html, text } = parcelStatusEmail({
        recipientName: name,
        trackingId: parcel.trackingId,
        status: parcel.status,
        note: latestNote,
        courierName: parcel.deliveryPersonnel?.name ?? null,
        trackingUrl,
      });

      await this.safeSend(user.email, subject, html, text);
    }
  }

  private async safeSend(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    try {
      await this.mailService.send(to, subject, html, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Parcel email to ${to} failed: ${message}`);
    }
  }
}
