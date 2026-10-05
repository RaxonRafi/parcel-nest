import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { webBaseUrl } from '../../common/utils/web-url.util';
import { MailService } from '../../mail/services/mail.service';
import { parcelStatusEmail } from '../../mail/templates/parcel-status.template';
import { RealtimeService } from '../../realtime/realtime.service';
import { RealtimeNotificationType } from '../../realtime/realtime.types';
import { Role } from '../../user/types/user.types';
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
 * Parcel emails and live dashboard pushes, fire-and-forget.
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
    private readonly realtime: RealtimeService,
  ) {}

  async notifyStatusChange(parcel: Parcel): Promise<void> {
    this.pushRealtime(parcel);

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

  /**
   * Every parcel write appends a status log before reaching here, so the
   * newest log describes what just happened and who did it.
   */
  private pushRealtime(parcel: Parcel): void {
    const log = parcel.statusLogs?.[parcel.statusLogs.length - 1];
    const { type, title } = describeEvent(parcel.status, log?.note);
    const label = parcel.status.toLowerCase().replace(/_/g, ' ');

    this.realtime.notify(
      {
        userIds: [
          parcel.sender?.id,
          parcel.receiver?.id,
          parcel.deliveryPersonnel?.id,
        ],
        roles: [Role.ADMIN],
        exceptUserId: log?.changedBy?.id,
      },
      {
        type,
        title,
        message:
          type === 'parcel.status'
            ? `${parcel.trackingId} is now ${label}${log?.note ? ` — ${log.note}` : ''}`
            : `${parcel.trackingId}: ${log?.note ?? title}`,
        trackingId: parcel.trackingId,
        status: parcel.status,
      },
    );
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

/** Status-log notes are written by `ParcelService`; these prefixes are its. */
function describeEvent(
  status: ParcelStatus,
  note?: string | null,
): { type: RealtimeNotificationType; title: string } {
  if (note === 'Parcel created') {
    return { type: 'parcel.created', title: 'New parcel' };
  }
  if (note?.startsWith('Assigned to')) {
    return { type: 'parcel.assigned', title: 'Courier assigned' };
  }
  if (note?.startsWith('Unassigned from')) {
    return { type: 'parcel.unassigned', title: 'Courier removed' };
  }
  if (note?.startsWith('Parcel blocked')) {
    return { type: 'parcel.blocked', title: 'Parcel on hold' };
  }
  if (note?.startsWith('Parcel unblocked')) {
    return { type: 'parcel.unblocked', title: 'Parcel released' };
  }

  const label = status.toLowerCase().replace(/_/g, ' ');
  return {
    type: 'parcel.status',
    title: `Parcel ${label}`,
  };
}
