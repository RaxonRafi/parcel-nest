import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated, paginate } from '../../common/types/paginated.type';
import { User } from '../../user/entities/user.entity';
import { QueryAuditDto } from '../dto/query-audit.dto';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditAction, AuditTargetType } from '../types/audit.types';

export interface AuditEntry {
  actor: User;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

/** Sole owner of the `audit_logs` table. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /**
   * Records an action. Never throws: an audit write failing must not roll back
   * the operation it describes — a missing log line is bad, a failed block is
   * worse. Failures are logged loudly so they are visible in monitoring.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditRepository.save(
        this.auditRepository.create({
          actor: entry.actor,
          actorEmail: entry.actor?.email ?? null,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          summary: entry.summary ?? null,
          metadata: entry.metadata ?? null,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `AUDIT WRITE FAILED — ${entry.action} on ${entry.targetType} ${entry.targetId}: ${message}`,
      );
    }
  }

  async find(query: QueryAuditDto): Promise<Paginated<AuditLog>> {
    const where: Record<string, unknown> = {};
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;

    const [data, total] = await this.auditRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });

    return paginate(data, total, query.page, query.limit);
  }

  /** Everything that has happened to one parcel or user. */
  async findForTarget(
    targetId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<AuditLog>> {
    const [data, total] = await this.auditRepository.findAndCount({
      where: { targetId },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });

    return paginate(data, total, query.page, query.limit);
  }
}
