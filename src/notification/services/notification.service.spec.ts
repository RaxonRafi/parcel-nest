import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { QueryNotificationsDto } from '../dto/query-notifications.dto';
import { Notification } from '../entities/notification.entity';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let repo: Record<string, jest.Mock>;

  const content = {
    type: 'parcel.status',
    title: 'Parcel delivered',
    message: 'TRK-1 is now delivered',
    trackingId: 'TRK-1',
    status: 'DELIVERED',
  };

  beforeEach(() => {
    repo = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn((rows: unknown) => Promise.resolve(rows)),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      count: jest.fn().mockResolvedValue(4),
      exists: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue({ affected: 2 }),
      delete: jest.fn().mockResolvedValue({ affected: 7 }),
    };
    service = new NotificationService(
      repo as unknown as Repository<Notification>,
    );
  });

  it('writes one unread row per recipient', async () => {
    const rows = await service.createForUsers(['a', 'b'], content);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user: { id: 'a' },
      type: 'parcel.status',
      trackingId: 'TRK-1',
      readAt: null,
    });
  });

  it('writes a person named twice only once', async () => {
    const rows = await service.createForUsers(['a', 'a', 'b'], content);

    expect(rows.map((row) => row.user.id)).toEqual(['a', 'b']);
  });

  it('does not touch the database for nobody', async () => {
    await expect(service.createForUsers([], content)).resolves.toEqual([]);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('lists only the caller’s, newest first', async () => {
    const query = Object.assign(new QueryNotificationsDto(), { page: 2, limit: 10 });

    await service.list('user-1', query);

    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { id: 'user-1' } },
        order: { createdAt: 'DESC' },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('can narrow the list to unread', async () => {
    const query = Object.assign(new QueryNotificationsDto(), { unread: true });

    await service.list('user-1', query);

    const [{ where }] = repo.findAndCount.mock.calls[0];
    expect(where).toHaveProperty('readAt');
  });

  it('answers 404 for a notification that is not the caller’s', async () => {
    repo.exists.mockResolvedValue(false);

    await expect(service.markRead('user-1', 'n-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('reports how many it marked read', async () => {
    await expect(service.markAllRead('user-1')).resolves.toBe(2);
  });

  it('prunes what is past retention', async () => {
    await expect(service.pruneOld()).resolves.toBe(7);
  });
});
