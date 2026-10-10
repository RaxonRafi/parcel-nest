import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { webBaseUrl } from '../../common/utils/web-url.util';
import { MailService } from '../../mail/services/mail.service';
import { parcelStatusEmail } from '../../mail/templates/parcel-status.template';
import { NotificationService } from '../../notification/services/notification.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { RealtimeNotificationType } from '../../realtime/realtime.types';
import { UserService } from '../../user/services/user.service';
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
 * Tells people a parcel changed: an inbox entry and a live push for everyone
 * it concerns, and an email to the sender and receiver for the statuses that
 * merit one.
 *
 * `ParcelService` runs this behind the response, after the write is
 * committed. Each channel still fails on its own — a parcel event must reach
 * the dashboard even when the mail server is down, and the other way round.
 */
@Injectable()
export class ParcelNotificationService {
  private readonly logger = new Logger(ParcelNotificationService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationService,
    private readonly userService: UserService,
  ) {}

  async notifyStatusChange(parcel: Parcel): Promise<void> {
    await this.notifyDashboards(parcel);

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
      // `=== false`, not falsy: a relation loaded without the column must not
      // read as an opt-out.
      if (!user?.email || user.emailNotifications === false) continue;

      const { subject, html, text } = parcelStatusEmail({
        recipientName: name,
        trackingId: parcel.trackingId,
        status: parcel.status,
        note: latestNote,
        courierName: parcel.deliveryPersonnel?.name ?? null,
        trackingUrl,
      });

      this.mailService.queue(user.email, subject, html, text);
    }
  }

  /**
   * Every parcel write appends a status log before reaching here, so the
   * newest log describes what just happened and who did it.
   *
   * The notification is stored first and pushed second, so the live event
   * carries the id it has in the inbox: a client can mark a pushed item read,
   * and one that was offline finds the same item waiting. If storing fails
   * the push still goes out, under a throwaway id.
   */
  private async notifyDashboards(parcel: Parcel): Promise<void> {
    const log = parcel.statusLogs?.[parcel.statusLogs.length - 1];
    const { type, title } = describeEvent(parcel.status, log?.note);
    const label = parcel.status.toLowerCase().replace(/_/g, ' ');
    const content = {
      type,
      title,
      message:
        type === 'parcel.status'
          ? `${parcel.trackingId} is now ${label}${log?.note ? ` — ${log.note}` : ''}`
          : `${parcel.trackingId}: ${log?.note ?? title}`,
      trackingId: parcel.trackingId,
      status: parcel.status,
    };

    const recipients = await this.recipientIds(parcel, log?.changedBy?.id);
    const stored = new Map<string, { id: string; createdAt: Date }>();

    try {
      for (const row of await this.notifications.createForUsers(
        recipients,
        content,
      )) {
        stored.set(row.user.id, row);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Could not store notifications for ${parcel.trackingId}: ${message}`,
      );
    }

    const now = new Date();
    for (const userId of recipients) {
      const row = stored.get(userId);

      this.realtime.push(userId, {
        ...content,
        id: row?.id ?? randomUUID(),
        createdAt: (row?.createdAt ?? now).toISOString(),
      });
    }
  }

  /**
   * The parcel's three parties plus every admin, minus whoever made the
   * change — nobody needs telling about their own click.
   */
  private async recipientIds(
    parcel: Parcel,
    actorId?: string | null,
  ): Promise<string[]> {
    let adminIds: string[] = [];
    try {
      adminIds = await this.userService.findActiveIdsByRole(Role.ADMIN);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not look up admins to notify: ${message}`);
    }

    const ids = new Set<string>(
      [
        parcel.sender?.id,
        parcel.receiver?.id,
        parcel.deliveryPersonnel?.id,
        ...adminIds,
      ].filter((id): id is string => !!id),
    );
    if (actorId) ids.delete(actorId);

    return [...ids];
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
