import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { RefreshToken, RevokeReason } from '../entities/refresh-token.entity';
import { SessionContext, SessionSummary } from '../types/auth.types';

/**
 * How long after a rotation the old token turning up again is still treated
 * as an accident. Two tabs refreshing at the same moment both send the same
 * token; the loser is refused, but it is not a thief.
 */
const REUSE_GRACE_MS = 10_000;

const ENDED = 'Session has ended — sign in again';

/** Sole owner of the `refresh_tokens` table. */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  /**
   * Records an issued refresh token so it can later be revoked.
   *
   * A sign-in starts a new family; a rotation passes the family of the token
   * it replaces, so the whole chain can be ended together.
   */
  async record(
    user: User,
    token: string,
    expiresAt: Date,
    context: SessionContext & { familyId?: string } = {},
  ): Promise<void> {
    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        user,
        tokenHash: hashToken(token),
        expiresAt,
        revokedAt: null,
        revokedReason: null,
        familyId: context.familyId ?? randomUUID(),
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ip: context.ip?.slice(0, 64) ?? null,
      }),
    );
  }

  /**
   * Confirms a refresh token is one we issued and still honour. A token that
   * verifies as a JWT but has no live row — revoked, rotated away, or issued
   * before this table existed — is rejected.
   *
   * A token that was *rotated away* and is presented again means two parties
   * hold the same chain: the user and whoever copied their token. There is no
   * telling which one this request is, so the whole family is ended and both
   * have to sign in again.
   */
  async assertActive(token: string): Promise<RefreshToken> {
    const rows = await this.findByToken(token);
    const now = Date.now();

    const live = rows.find(
      (row) => !row.revokedAt && row.expiresAt.getTime() > now,
    );
    if (live) return live;

    const rotated = rows.find(
      (row) =>
        row.revokedReason === 'rotated' &&
        row.revokedAt &&
        now - row.revokedAt.getTime() > REUSE_GRACE_MS,
    );
    if (rotated) {
      const ended = await this.revokeFamily(familyOf(rotated), 'reuse');
      this.logger.warn(
        `Refresh token reuse detected — ended ${ended} session(s) in family ${familyOf(rotated)}`,
      );
    }

    throw new UnauthorizedException(ENDED);
  }

  async findActive(token: string): Promise<RefreshToken | null> {
    const now = Date.now();

    return (
      (await this.findByToken(token)).find(
        (row) => !row.revokedAt && row.expiresAt.getTime() > now,
      ) ?? null
    );
  }

  /**
   * Ends one session. Pass `userId` to refuse a token that belongs to someone
   * else: logout takes the token from the request, so it has to be checked
   * against the caller.
   *
   * The write is conditional on the row still being live, so of two concurrent
   * calls with the same token exactly one reports success. Rotation relies on
   * that to stop a refresh token being exchanged twice.
   */
  async revoke(
    token: string,
    userId?: string,
    reason: RevokeReason = 'logout',
  ): Promise<boolean> {
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
      { revokedAt: new Date(), revokedReason: reason },
    );

    return (result.affected ?? 0) > 0;
  }

  /** Ends every session for a user — logout-everywhere, and after a reset. */
  async revokeAllForUser(
    userId: string,
    reason: RevokeReason = 'logout',
  ): Promise<number> {
    const result = await this.refreshTokenRepository.update(
      { user: { id: userId }, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );

    return result.affected ?? 0;
  }

  /** Ends whatever is still live in one rotation chain. */
  async revokeFamily(familyId: string, reason: RevokeReason): Promise<number> {
    const result = await this.refreshTokenRepository.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );

    return result.affected ?? 0;
  }

  /**
   * The user's signed-in devices, newest first. Each family has at most one
   * live token, so one row is one device. `currentToken` marks the session
   * the request itself came from, when the caller can supply it.
   */
  async listForUser(
    userId: string,
    currentToken?: string,
  ): Promise<SessionSummary[]> {
    const rows = await this.refreshTokenRepository.find({
      where: {
        user: { id: userId },
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
    const currentHash = currentToken ? hashToken(currentToken) : null;

    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      current: currentHash !== null && matches(row.tokenHash, currentHash),
    }));
  }

  /** "Sign out this device". Scoped to the owner, so ids cannot be probed. */
  async revokeById(id: string, userId: string): Promise<void> {
    const result = await this.refreshTokenRepository.update(
      { id, user: { id: userId }, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: 'logout' },
    );

    if (!result.affected) {
      throw new NotFoundException('Session not found');
    }
  }

  /** Housekeeping for expired rows; safe to call from a cron. */
  async pruneExpired(): Promise<number> {
    const result = await this.refreshTokenRepository.delete({
      expiresAt: LessThan(new Date()),
    });

    return result.affected ?? 0;
  }

  /** Every row for this token, live or not. */
  private async findByToken(token: string): Promise<RefreshToken[]> {
    const tokenHash = hashToken(token);
    const candidates = await this.refreshTokenRepository.find({
      where: { tokenHash },
    });

    // Constant-time compare even though the hash was the lookup key: the
    // column is indexed, not unique, so this is the actual match.
    return candidates.filter((row) => matches(row.tokenHash, tokenHash));
  }
}

/** A row from before families existed is the root of its own. */
export function familyOf(row: RefreshToken): string {
  return row.familyId ?? row.id;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function matches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
