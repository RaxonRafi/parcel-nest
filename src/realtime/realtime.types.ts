import { ParcelStatus } from '../parcel/types/parcel.types';
import { Role } from '../user/types/user.types';

/** The one event name the gateway emits. */
export const NOTIFICATION_EVENT = 'notification';

export type RealtimeNotificationType =
  | 'parcel.created'
  | 'parcel.status'
  | 'parcel.assigned'
  | 'parcel.unassigned'
  | 'parcel.blocked'
  | 'parcel.unblocked';

/** Pushed to connected dashboards. Not persisted — a missed push is gone. */
export interface RealtimeNotification {
  id: string;
  type: RealtimeNotificationType;
  title: string;
  message: string;
  trackingId: string;
  status: ParcelStatus;
  createdAt: string;
}

export const userRoom = (userId: string): string => `user:${userId}`;
export const roleRoom = (role: Role): string => `role:${role}`;
