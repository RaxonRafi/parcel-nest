/** What a notification says, before it is addressed to anyone. */
export interface NotificationContent {
  type: string;
  title: string;
  message: string;
  trackingId?: string | null;
  status?: string | null;
}
