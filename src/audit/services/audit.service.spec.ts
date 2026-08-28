import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { User } from '../../user/entities/user.entity';
import { QueryAuditDto } from '../dto/query-audit.dto';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditAction, AuditTargetType } from '../types/audit.types';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let repo: { save: jest.Mock; create: jest.Mock; findAndCount: jest.Mock };

  const actor = { id: 'admin-1', email: 'root@example.com' } as User;

  const entry = {
    actor,
    action: AuditAction.USER_BLOCKED,
    targetType: AuditTargetType.USER,
    targetId: 'user-9',
    summary: 'Blocked jane@example.com',
    metadata: { from: 'ACTIVE', to: 'BLOCKED' },
  };

  beforeEach(async () => {
    repo = {
      save: jest.fn((v) => v),
      create: jest.fn((v) => v),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe('record', () => {
    it('denormalises the actor email so the trail outlives the account', async () => {
      await service.record(entry);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actor,
          actorEmail: 'root@example.com',
          action: AuditAction.USER_BLOCKED,
          targetId: 'user-9',
        }),
      );
    });

    it('keeps the before/after metadata', async () => {
      await service.record(entry);

      expect(repo.create.mock.calls[0][0].metadata).toEqual({
        from: 'ACTIVE',
        to: 'BLOCKED',
      });
    });

    it('nulls optional fields rather than leaving them undefined', async () => {
      await service.record({
        actor,
        action: AuditAction.PARCEL_BLOCKED,
        targetType: AuditTargetType.PARCEL,
        targetId: 'TRK-1',
      });

      const created = repo.create.mock.calls[0][0];
      expect(created.summary).toBeNull();
      expect(created.metadata).toBeNull();
    });

    it('swallows a write failure so the audited action still succeeds', async () => {
      repo.save.mockRejectedValue(new Error('table is gone'));

      await expect(service.record(entry)).resolves.toBeUndefined();
    });
  });

  describe('find', () => {
    it('applies only the filters that were supplied', async () => {
      const query = Object.assign(new QueryAuditDto(), {
        page: 1,
        limit: 20,
        action: AuditAction.PARCEL_ASSIGNED,
      });

      await service.find(query);

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: AuditAction.PARCEL_ASSIGNED },
          order: { createdAt: 'DESC' },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('returns the paginated envelope', async () => {
      repo.findAndCount.mockResolvedValue([[{ id: 'a' }], 41]);
      const query = Object.assign(new QueryAuditDto(), { page: 2, limit: 20 });

      const result = await service.find(query);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({
        page: 2,
        total: 41,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });
  });

  describe('findForTarget', () => {
    it('scopes to the one target', async () => {
      const query = Object.assign(new PaginationQueryDto(), {
        page: 1,
        limit: 20,
      });

      await service.findForTarget('TRK-1', query);

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { targetId: 'TRK-1' } }),
      );
    });
  });
});
