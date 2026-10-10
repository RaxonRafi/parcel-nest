import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { Paginated, paginate } from '../../common/types/paginated.type';
import { QueryNotificationsDto } from '../dto/query-notifications.dto';
import { Notification } from '../entities/notification.entity';
import { NotificationContent } from '../types/notification.types';

/** Read or not, nobody scrolls back further than this. */
const RETENTION_DAYS = 90;

/** Sole owner of the `notifications` table. */
@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
  ) {}

  /**
   * Writes the same notification into each recipient's inbox and returns the
   * rows, so a live push can carry the id it was stored under.
   */
  async createForUsers(
    userIds: string[],
    content: NotificationContent,
  ): Promise<Notification[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];

    return this.repository.save(
      unique.map((userId) =>
        this.repository.create({
          user: { id: userId },
          type: content.type,
          title: content.title,
          message: content.message,
          trackingId: content.trackingId ?? null,
          status: content.status ?? null,
          readAt: null,
        }),
      ),
    );
  }

  async list(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<Paginated<Notification>> {
    const [rows, total] = await this.repository.findAndCount({
      where: {
        user: { id: userId },
        ...(query.unread ? { readAt: IsNull() } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });

    return paginate(rows, total, query.page, query.limit);
  }

  unreadCount(userId: string): Promise<number> {
    return this.repository.count({
      where: { user: { id: userId }, readAt: IsNull() },
    });
  }

  /** Scoped to the owner, so another user's ids simply do not exist. */
  async markRead(userId: string, id: string): Promise<void> {
    const exists = await this.repository.exists({
      where: { id, user: { id: userId } },
    });

    if (!exists) {
      throw new NotFoundException('Notification not found');
    }

    // Conditional, so opening the same one twice keeps the first read time.
    await this.repository.update(
      { id, user: { id: userId }, readAt: IsNull() },
      { readAt: new Date() },
    );
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.repository.update(
      { user: { id: userId }, readAt: IsNull() },
      { readAt: new Date() },
    );

    return result.affected ?? 0;
  }

  /** Housekeeping; safe to call from a cron. */
  async pruneOld(): Promise<number> {
    const result = await this.repository.delete({
      createdAt: LessThan(new Date(Date.now() - RETENTION_DAYS * 86_400_000)),
    });

    return result.affected ?? 0;
  }
}
