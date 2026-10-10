import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';

/** Sole owner of the `refresh_tokens` table. */
@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  /** Records an issued refresh token so it can later be revoked. */
  async record(user: User, token: string, expiresAt: Date): Promise<void> {
    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        user,
        tokenHash: hashToken(token),
        expiresAt,
        revokedAt: null,
      }),
    );
  }

  /**
   * Confirms a refresh token is one we issued and still honour. A token that
   * verifies as a JWT but has no live row — revoked, rotated away, or issued
   * before this table existed — is rejected.
   */
  async assertActive(token: string): Promise<RefreshToken> {
    const stored = await this.findActive(token);

    if (!stored) {
      throw new UnauthorizedException('Session has ended — sign in again');
    }

    return stored;
  }

  async findActive(token: string): Promise<RefreshToken | null> {
    const candidates = await this.refreshTokenRepository.find({
      where: { tokenHash: hashToken(token), revokedAt: IsNull() },
    });

    const now = Date.now();
    for (const row of candidates) {
      // Constant-time compare even though the hash was the lookup key: the
      // column is indexed, not unique, so this is the actual match.
      if (
        matches(row.tokenHash, hashToken(token)) &&
        row.expiresAt.getTime() > now
      ) {
        return row;
      }
    }

    return null;
  }

  /**
   * Ends one session. Pass `userId` to refuse a token that belongs to someone
   * else: logout takes the token from the request body, so it has to be
   * checked against the caller.
   *
   * The write is conditional on the row still being live, so of two concurrent
   * calls with the same token exactly one reports success. Rotation relies on
   * that to stop a refresh token being exchanged twice.
   */
  async revoke(token: string, userId?: string): Promise<boolean> {
    const stored = await this.findActive(token);

    if (!stored) {
      return false;
    }

    const result = await this.refreshTokenRepository.update(
      {
        id: stored.id,
        revokedAt: IsNull(),
        ...(userId ? { user: { id: userId } } : {}),
      },
      { revokedAt: new Date() },
    );

    return (result.affected ?? 0) > 0;
  }

  /** Ends every session for a user — logout-everywhere, and after a reset. */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.refreshTokenRepository.update(
      { user: { id: userId }, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return result.affected ?? 0;
  }

  /** Housekeeping for expired rows; safe to call from a cron. */
  async pruneExpired(): Promise<number> {
    const result = await this.refreshTokenRepository.delete({
      expiresAt: LessThan(new Date()),
    });

    return result.affected ?? 0;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function matches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
