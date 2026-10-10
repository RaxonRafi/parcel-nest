import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import {
  NOTIFICATION_EVENT,
  RealtimeNotification,
  userRoom,
} from './realtime.types';

/**
 * Fire-and-forget pushes to connected dashboards. Never throws: a parcel
 * write has already committed by the time this runs.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  /**
   * Sends one user their copy of a notification, on every device they have
   * open. Addressed per user rather than broadcast to a role, because each
   * copy carries the id of that user's own inbox row.
   */
  push(userId: string, notification: RealtimeNotification): void {
    // No server on a serverless host, where the gateway never initialises.
    // The notification is still in the user's inbox; only the push is lost.
    const server = this.gateway.server;
    if (!server) return;

    try {
      server.to(userRoom(userId)).emit(NOTIFICATION_EVENT, notification);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Realtime push failed: ${message}`);
    }
  }
}
