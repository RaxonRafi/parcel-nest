import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { User } from '../../user/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { SessionService, hashToken } from './session.service';

describe('SessionService', () => {
  let service: SessionService;
  let repo: {
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  const user = { id: 'user-1' } as User;
  const TOKEN = 'header.payload.signature';

  const storedRow = (overrides: Partial<RefreshToken> = {}): RefreshToken =>
    ({
      id: 'row-1',
      tokenHash: hashToken(TOKEN),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      ...overrides,
    }) as RefreshToken;

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      save: jest.fn((v) => v),
      create: jest.fn((v) => v),
      update: jest.fn().mockResolvedValue({ affected: 3 }),
      delete: jest.fn().mockResolvedValue({ affected: 2 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: getRepositoryToken(RefreshToken), useValue: repo },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  describe('hashToken', () => {
    it('stores a sha256, never the token itself', () => {
      const hash = hashToken(TOKEN);

      expect(hash).toBe(createHash('sha256').update(TOKEN).digest('hex'));
      expect(hash).not.toContain(TOKEN);
      expect(hash).toHaveLength(64);
    });
  });

  describe('record', () => {
    it('persists the hash rather than the token', async () => {
      const expiresAt = new Date();

      await service.record(user, TOKEN, expiresAt);

      const saved = repo.save.mock.calls[0][0];
      expect(saved.tokenHash).toBe(hashToken(TOKEN));
      expect(JSON.stringify(saved)).not.toContain(TOKEN);
    });
  });

  describe('findActive', () => {
    it('returns a live row', async () => {
      repo.find.mockResolvedValue([storedRow()]);

      await expect(service.findActive(TOKEN)).resolves.not.toBeNull();
    });

    it('rejects an expired row', async () => {
      repo.find.mockResolvedValue([
        storedRow({ expiresAt: new Date(Date.now() - 1) }),
      ]);

      await expect(service.findActive(TOKEN)).resolves.toBeNull();
    });

    it('returns null when nothing matches', async () => {
      repo.find.mockResolvedValue([]);

      await expect(service.findActive(TOKEN)).resolves.toBeNull();
    });
  });

  describe('assertActive', () => {
    it('throws for a token with no live row', async () => {
      repo.find.mockResolvedValue([]);

      await expect(service.assertActive(TOKEN)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('revoke', () => {
    it('stamps revokedAt and reports success', async () => {
      const row = storedRow();
      repo.find.mockResolvedValue([row]);

      await expect(service.revoke(TOKEN)).resolves.toBe(true);
      expect(row.revokedAt).toBeInstanceOf(Date);
    });

    it('reports false when there was nothing to revoke', async () => {
      repo.find.mockResolvedValue([]);

      await expect(service.revoke(TOKEN)).resolves.toBe(false);
    });
  });

  describe('revokeAllForUser', () => {
    it('returns how many sessions ended', async () => {
      await expect(service.revokeAllForUser('user-1')).resolves.toBe(3);
    });
  });
});
