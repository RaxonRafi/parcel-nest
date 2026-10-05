import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Role } from '../user/types/user.types';
import { RealtimeGateway } from './realtime.gateway';
import {
  NOTIFICATION_EVENT,
  RealtimeNotification,
  roleRoom,
  userRoom,
} from './realtime.types';

export interface NotifyTarget {
  userIds?: (string | null | undefined)[];
  roles?: Role[];
  /** Usually the actor — nobody needs telling about their own click. */
  exceptUserId?: string | null;
}

/**
 * Fire-and-forget pushes to connected dashboards. Never throws: a parcel
 * write has already committed by the time this runs.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  notify(
    target: NotifyTarget,
    notification: Omit<RealtimeNotification, 'id' | 'createdAt'>,
  ): void {
    // No server on a serverless host, where the gateway never initialises.
    const server = this.gateway.server;
    if (!server) return;

    const rooms = [
      ...(target.userIds ?? [])
        .filter((id): id is string => !!id)
        .map(userRoom),
      ...(target.roles ?? []).map(roleRoom),
    ];
    if (rooms.length === 0) return;

    try {
      let broadcast = server.to(rooms);
      if (target.exceptUserId) {
        broadcast = broadcast.except(userRoom(target.exceptUserId));
      }
      broadcast.emit(NOTIFICATION_EVENT, {
        ...notification,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      } satisfies RealtimeNotification);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Realtime push failed: ${message}`);
    }
  }
}
