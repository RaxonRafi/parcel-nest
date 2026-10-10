import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { User } from '../../user/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { SessionService, familyOf, hashToken } from './session.service';

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
      familyId: 'family-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      revokedReason: null,
      userAgent: null,
      ip: null,
      createdAt: new Date(),
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

    it('starts a new family for a sign-in', async () => {
      await service.record(user, TOKEN, new Date());
      await service.record(user, 'another.token.here', new Date());

      const [first, second] = repo.save.mock.calls.map(([row]) => row.familyId);
      expect(first).toEqual(expect.any(String));
      expect(second).not.toBe(first);
    });

    it('joins the family it is given, and remembers the device', async () => {
      await service.record(user, TOKEN, new Date(), {
        familyId: 'family-9',
        userAgent: 'Firefox',
        ip: '203.0.113.7',
      });

      expect(repo.save.mock.calls[0][0]).toMatchObject({
        familyId: 'family-9',
        userAgent: 'Firefox',
        ip: '203.0.113.7',
      });
    });

    it('trims a user agent to what the column holds', async () => {
      await service.record(user, TOKEN, new Date(), {
        userAgent: 'x'.repeat(400),
      });

      expect(repo.save.mock.calls[0][0].userAgent).toHaveLength(255);
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

    it('rejects a revoked row', async () => {
      repo.find.mockResolvedValue([storedRow({ revokedAt: new Date() })]);

      await expect(service.findActive(TOKEN)).resolves.toBeNull();
    });

    it('returns null when nothing matches', async () => {
      repo.find.mockResolvedValue([]);

      await expect(service.findActive(TOKEN)).resolves.toBeNull();
    });
  });

  describe('assertActive', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('returns the live row', async () => {
      repo.find.mockResolvedValue([storedRow()]);

      await expect(service.assertActive(TOKEN)).resolves.toMatchObject({
        id: 'row-1',
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('throws for a token with no row at all', async () => {
      repo.find.mockResolvedValue([]);

      await expect(service.assertActive(TOKEN)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('ends the whole family when a rotated token comes back', async () => {
      repo.find.mockResolvedValue([
        storedRow({
          revokedAt: new Date(Date.now() - 60_000),
          revokedReason: 'rotated',
        }),
      ]);

      await expect(service.assertActive(TOKEN)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'family-1' }),
        expect.objectContaining({ revokedReason: 'reuse' }),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('reuse'));
    });

    it('treats a row from before families as the root of its own', async () => {
      repo.find.mockResolvedValue([
        storedRow({
          familyId: null,
          revokedAt: new Date(Date.now() - 60_000),
          revokedReason: 'rotated',
        }),
      ]);

      await expect(service.assertActive(TOKEN)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'row-1' }),
        expect.anything(),
      );
    });

    it('forgives two tabs refreshing at the same moment', async () => {
      // Rotated a second ago: the loser of a race, not a thief.
      repo.find.mockResolvedValue([
        storedRow({
          revokedAt: new Date(Date.now() - 1_000),
          revokedReason: 'rotated',
        }),
      ]);

      await expect(service.assertActive(TOKEN)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('leaves the family alone for a token that was simply logged out', async () => {
      repo.find.mockResolvedValue([
        storedRow({
          revokedAt: new Date(Date.now() - 60_000),
          revokedReason: 'logout',
        }),
      ]);

      await expect(service.assertActive(TOKEN)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('stamps revokedAt and reports success', async () => {
      repo.find.mockResolvedValue([storedRow()]);
      repo.update.mockResolvedValue({ affected: 1 });

      await expect(service.revoke(TOKEN)).resolves.toBe(true);
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'row-1' }),
        { revokedAt: expect.any(Date), revokedReason: 'logout' },
      );
    });

    it('records why, so a rotation can be told from a logout', async () => {
      repo.find.mockResolvedValue([storedRow()]);
      repo.update.mockResolvedValue({ affected: 1 });

      await service.revoke(TOKEN, undefined, 'rotated');

      expect(repo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ revokedReason: 'rotated' }),
      );
    });

    it('reports false when another request revoked it first', async () => {
      repo.find.mockResolvedValue([storedRow()]);
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.revoke(TOKEN)).resolves.toBe(false);
    });

    it('only touches the given user when one is named', async () => {
      repo.find.mockResolvedValue([storedRow()]);
      repo.update.mockResolvedValue({ affected: 0 });

      await service.revoke(TOKEN, 'user-2');

      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: 'user-2' } }),
        expect.anything(),
      );
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

  describe('listForUser', () => {
    it('marks the session the request came from', async () => {
      repo.find.mockResolvedValue([
        storedRow({ id: 'this-device', userAgent: 'Firefox' }),
        storedRow({ id: 'other-device', tokenHash: hashToken('other') }),
      ]);

      const sessions = await service.listForUser('user-1', TOKEN);

      expect(sessions.map((s) => [s.id, s.current])).toEqual([
        ['this-device', true],
        ['other-device', false],
      ]);
    });

    it('never hands the token hash to the client', async () => {
      repo.find.mockResolvedValue([storedRow()]);

      const [session] = await service.listForUser('user-1');

      expect(session).not.toHaveProperty('tokenHash');
      expect(session.current).toBe(false);
    });
  });

  describe('revokeById', () => {
    it('is scoped to the owner', async () => {
      repo.update.mockResolvedValue({ affected: 1 });

      await service.revokeById('row-1', 'user-1');

      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'row-1', user: { id: 'user-1' } }),
        expect.anything(),
      );
    });

    it("answers 404 for someone else's session, as if it did not exist", async () => {
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.revokeById('row-1', 'intruder'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('familyOf', () => {
    it('falls back to the row id', () => {
      expect(familyOf(storedRow())).toBe('family-1');
      expect(familyOf(storedRow({ familyId: null }))).toBe('row-1');
    });
  });
});
