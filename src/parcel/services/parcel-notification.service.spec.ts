import { ConfigService } from '@nestjs/config';
import { MailService } from '../../mail/services/mail.service';
import { NotificationService } from '../../notification/services/notification.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { User } from '../../user/entities/user.entity';
import { UserService } from '../../user/services/user.service';
import { Parcel } from '../entities/parcel.entity';
import { ParcelStatus } from '../types/parcel.types';
import { ParcelNotificationService } from './parcel-notification.service';

describe('ParcelNotificationService', () => {
  let service: ParcelNotificationService;
  let mail: { queue: jest.Mock };
  let realtime: { push: jest.Mock };
  let notifications: { createForUsers: jest.Mock };
  let userService: { findActiveIdsByRole: jest.Mock };

  const person = (id: string, extra: Partial<User> = {}) =>
    ({ id, email: `${id}@test.com`, emailNotifications: true, ...extra }) as User;

  const buildParcel = (overrides: Partial<Parcel> = {}): Parcel =>
    ({
      trackingId: 'TRK-1',
      status: ParcelStatus.OUT_FOR_DELIVERY,
      senderName: 'John Sender',
      receiverName: 'Jane Doe',
      sender: person('sender'),
      receiver: person('receiver'),
      deliveryPersonnel: person('courier', { name: 'Cal Rahman' }),
      statusLogs: [
        {
          status: ParcelStatus.OUT_FOR_DELIVERY,
          note: 'On the van',
          changedBy: person('courier'),
        },
      ],
      ...overrides,
    }) as unknown as Parcel;

  beforeEach(() => {
    mail = { queue: jest.fn() };
    realtime = { push: jest.fn() };
    notifications = {
      createForUsers: jest.fn((ids: string[]) =>
        Promise.resolve(
          ids.map((id) => ({
            id: `row-${id}`,
            user: { id },
            createdAt: new Date('2026-10-10T08:00:00Z'),
          })),
        ),
      ),
    };
    userService = {
      findActiveIdsByRole: jest.fn().mockResolvedValue(['admin-1', 'admin-2']),
    };

    service = new ParcelNotificationService(
      mail as unknown as MailService,
      { get: () => 'https://app.example.com' } as unknown as ConfigService,
      realtime as unknown as RealtimeService,
      notifications as unknown as NotificationService,
      userService as unknown as UserService,
    );
  });

  const pushedTo = () => realtime.push.mock.calls.map(([userId]) => userId);

  it('reaches every party and every admin, except whoever made the change', async () => {
    await service.notifyStatusChange(buildParcel());

    const [recipients] = notifications.createForUsers.mock.calls[0];
    expect([...recipients].sort()).toEqual([
      'admin-1',
      'admin-2',
      'receiver',
      'sender',
    ]);
    expect(pushedTo().sort()).toEqual([
      'admin-1',
      'admin-2',
      'receiver',
      'sender',
    ]);
  });

  it('pushes each person the id of their own inbox row', async () => {
    await service.notifyStatusChange(buildParcel());

    for (const [userId, notification] of realtime.push.mock.calls) {
      expect(notification).toMatchObject({
        id: `row-${userId}`,
        type: 'parcel.status',
        trackingId: 'TRK-1',
        createdAt: '2026-10-10T08:00:00.000Z',
      });
    }
  });

  it('still pushes when the inbox cannot be written', async () => {
    notifications.createForUsers.mockRejectedValue(new Error('db down'));

    await service.notifyStatusChange(buildParcel());

    expect(pushedTo()).toHaveLength(4);
    expect(realtime.push.mock.calls[0][1].id).toEqual(expect.any(String));
  });

  it('notifies an admin who is also a party only once', async () => {
    userService.findActiveIdsByRole.mockResolvedValue(['sender', 'admin-1']);

    await service.notifyStatusChange(buildParcel());

    expect(pushedTo().filter((id) => id === 'sender')).toHaveLength(1);
  });

  it('emails the sender and the receiver for a status worth an email', async () => {
    await service.notifyStatusChange(buildParcel());

    expect(mail.queue.mock.calls.map(([to]) => to)).toEqual([
      'receiver@test.com',
      'sender@test.com',
    ]);
  });

  it('respects an opt-out, without touching the dashboard notification', async () => {
    await service.notifyStatusChange(
      buildParcel({ receiver: person('receiver', { emailNotifications: false }) }),
    );

    expect(mail.queue.mock.calls.map(([to]) => to)).toEqual(['sender@test.com']);
    expect(pushedTo()).toContain('receiver');
  });

  it('sends no email for an intermediate status', async () => {
    await service.notifyStatusChange(
      buildParcel({ status: ParcelStatus.IN_TRANSIT }),
    );

    expect(mail.queue).not.toHaveBeenCalled();
    expect(realtime.push).toHaveBeenCalled();
  });

  it.each([
    ['Parcel created', 'parcel.created'],
    ['Assigned to Cal', 'parcel.assigned'],
    ['Unassigned from Cal', 'parcel.unassigned'],
    ['Parcel blocked by admin', 'parcel.blocked'],
    ['Parcel unblocked by admin', 'parcel.unblocked'],
    ['Left the hub', 'parcel.status'],
  ])('reads the note %p as a %s event', async (note, type) => {
    await service.notifyStatusChange(
      buildParcel({
        statusLogs: [
          { status: ParcelStatus.IN_TRANSIT, note },
        ] as unknown as Parcel['statusLogs'],
      }),
    );

    expect(notifications.createForUsers.mock.calls[0][1].type).toBe(type);
  });
});
