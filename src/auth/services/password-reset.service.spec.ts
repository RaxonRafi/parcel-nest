import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { MailService } from '../../mail/services/mail.service';
import { User } from '../../user/entities/user.entity';
import { PasswordReset } from '../entities/password-reset.entity';
import { PasswordResetService } from './password-reset.service';
import { hashToken } from './session.service';

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let repo: Record<string, jest.Mock>;
  let mail: { queue: jest.Mock };

  const user = { id: 'user-1', name: 'Jane', email: 'jane@example.com' } as User;
  const TOKEN = 'a'.repeat(64);

  const grant = (overrides: Partial<PasswordReset> = {}): PasswordReset =>
    ({
      id: 'grant-1',
      user,
      tokenHash: hashToken(TOKEN),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      ...overrides,
    }) as PasswordReset;

  /** The link is the only place the plain token ever appears. */
  const tokenInLastEmail = (): string => {
    const [, , , text] = mail.queue.mock.calls.at(-1) as string[];
    return /token=([0-9a-f]{64})/.exec(text)![1];
  };

  beforeEach(() => {
    repo = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 5 }),
    };
    mail = { queue: jest.fn() };
    service = new PasswordResetService(
      repo as unknown as Repository<PasswordReset>,
      mail as unknown as MailService,
      {
        get: (key: string) =>
          key === 'FRONTEND_URL' ? 'https://app.example.com/' : undefined,
      } as unknown as ConfigService,
    );
  });

  describe('issue', () => {
    it('stores only a hash of the token it emails', async () => {
      await service.issue(user);

      const saved = repo.save.mock.calls[0][0] as PasswordReset;
      const token = tokenInLastEmail();
      expect(saved.tokenHash).toBe(hashToken(token));
      expect(JSON.stringify(saved)).not.toContain(token);
    });

    it('links to the client, on its reset page', async () => {
      await service.issue(user);

      const [to, subject, , text] = mail.queue.mock.calls[0] as string[];
      expect(to).toBe('jane@example.com');
      expect(subject).toMatch(/Reset/);
      expect(text).toContain('https://app.example.com/reset-password?token=');
    });

    it('expires in half an hour', async () => {
      const before = Date.now();

      await service.issue(user);

      const { expiresAt } = repo.save.mock.calls[0][0] as PasswordReset;
      const minutes = (expiresAt.getTime() - before) / 60_000;
      expect(minutes).toBeGreaterThan(29.9);
      expect(minutes).toBeLessThan(30.1);
    });

    it('spends any link the user already holds first', async () => {
      await service.issue(user);

      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: 'user-1' } }),
        { usedAt: expect.any(Date) },
      );
      expect(repo.update.mock.invocationCallOrder[0]).toBeLessThan(
        repo.save.mock.invocationCallOrder[0],
      );
    });

    it('queues the email rather than waiting on the mail server', async () => {
      // `queue` returns nothing to await: a slow or failing SMTP server can
      // neither delay this response nor change it.
      await expect(service.issue(user)).resolves.toBeUndefined();
      expect(mail.queue).toHaveBeenCalledTimes(1);
    });
  });

  describe('issueClaim', () => {
    it('gives a receiver a week, and tells them who sent the parcel', async () => {
      const before = Date.now();

      await service.issueClaim(user, 'John Sender', 'TRK-1');

      const { expiresAt } = repo.save.mock.calls[0][0] as PasswordReset;
      const days = (expiresAt.getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);

      const [, subject, , text] = mail.queue.mock.calls[0] as string[];
      expect(subject).toContain('John Sender');
      expect(text).toContain('TRK-1');
    });
  });

  describe('consume', () => {
    it('returns the grant and spends it', async () => {
      repo.findOne.mockResolvedValue(grant());

      await expect(service.consume(TOKEN)).resolves.toMatchObject({
        id: 'grant-1',
        user,
      });
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tokenHash: hashToken(TOKEN) }),
        }),
      );
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'grant-1' }),
        { usedAt: expect.any(Date) },
      );
    });

    it('refuses a token it never issued', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.consume(TOKEN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses an expired link without spending it', async () => {
      repo.findOne.mockResolvedValue(
        grant({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(service.consume(TOKEN)).rejects.toThrow(/expired/);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets only one of two simultaneous uses through', async () => {
      repo.findOne.mockResolvedValue(grant());
      // The other request stamped `usedAt` between this read and this write.
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.consume(TOKEN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('prunes expired grants', async () => {
    await expect(service.pruneExpired()).resolves.toBe(5);
  });
});
