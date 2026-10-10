import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { MailService } from '../../mail/services/mail.service';
import { User } from '../../user/entities/user.entity';
import { EmailVerification } from '../entities/email-verification.entity';
import { EmailVerificationService } from './email-verification.service';
import { hashToken } from './session.service';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let repo: Record<string, jest.Mock>;
  let mail: { queue: jest.Mock };

  const user = {
    id: 'user-1',
    name: 'Jane',
    email: 'jane@example.com',
    isVerified: false,
  } as User;
  const TOKEN = 'b'.repeat(64);

  const grant = (overrides: Partial<EmailVerification> = {}) =>
    ({
      id: 'grant-1',
      user,
      tokenHash: hashToken(TOKEN),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      ...overrides,
    }) as EmailVerification;

  beforeEach(() => {
    repo = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    mail = { queue: jest.fn() };
    service = new EmailVerificationService(
      repo as unknown as Repository<EmailVerification>,
      mail as unknown as MailService,
      {
        get: (key: string) =>
          key === 'FRONTEND_URL' ? 'https://app.example.com' : undefined,
      } as unknown as ConfigService,
    );
  });

  describe('issue', () => {
    it('emails a link whose token is stored only as a hash', async () => {
      await service.issue(user);

      const [to, , , text] = mail.queue.mock.calls[0] as string[];
      const token = /verify-email\?token=([0-9a-f]{64})/.exec(text)![1];
      const saved = repo.save.mock.calls[0][0] as EmailVerification;

      expect(to).toBe('jane@example.com');
      expect(text).toContain('https://app.example.com/verify-email?token=');
      expect(saved.tokenHash).toBe(hashToken(token));
      expect(JSON.stringify(saved)).not.toContain(token);
    });

    it('is valid for a day', async () => {
      const before = Date.now();

      await service.issue(user);

      const { expiresAt } = repo.save.mock.calls[0][0] as EmailVerification;
      const hours = (expiresAt.getTime() - before) / 3_600_000;
      expect(hours).toBeGreaterThan(23.99);
      expect(hours).toBeLessThan(24.01);
    });

    it('invalidates the previous link when another is requested', async () => {
      await service.issue(user);

      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: 'user-1' } }),
        { usedAt: expect.any(Date) },
      );
    });

    it('does nothing for an address that is already confirmed', async () => {
      await service.issue({ ...user, isVerified: true });

      expect(repo.save).not.toHaveBeenCalled();
      expect(mail.queue).not.toHaveBeenCalled();
    });
  });

  describe('consume', () => {
    it('returns whose address was confirmed, and spends the link', async () => {
      repo.findOne.mockResolvedValue(grant());

      await expect(service.consume(TOKEN)).resolves.toBe(user);
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'grant-1' }),
        { usedAt: expect.any(Date) },
      );
    });

    it('refuses an unknown token', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.consume(TOKEN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses an expired link', async () => {
      repo.findOne.mockResolvedValue(
        grant({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(service.consume(TOKEN)).rejects.toThrow(/expired/);
    });

    it('lets only one of two simultaneous opens through', async () => {
      repo.findOne.mockResolvedValue(grant());
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.consume(TOKEN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('prunes expired grants', async () => {
    await expect(service.pruneExpired()).resolves.toBe(3);
  });
});
