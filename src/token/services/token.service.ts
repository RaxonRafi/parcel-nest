import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { AppJwtPayload, TokenPair, TokenSubject } from '../types/token.types';

/**
 * Pure JWT signing/verification. It deliberately has no database dependency,
 * which is what keeps `UserModule` and `AuthModule` free of circular imports.
 */
@Injectable()
export class TokenService {
  constructor(private readonly configService: ConfigService) {}

  createUserTokens(user: TokenSubject): TokenPair {
    const payload: AppJwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      accessToken: this.signAccessToken(payload),
      refreshToken: this.sign(
        payload,
        this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES'),
        // A JWT is a pure function of its payload and `iat`, which has
        // one-second resolution. Without a unique id, two refresh tokens
        // issued to one user in the same second are the same string — so a
        // rotation hands back the token it just revoked, and two devices
        // signing in together share one session row.
        randomUUID(),
      ),
    };
  }

  signAccessToken(payload: AppJwtPayload): string {
    return this.sign(
      payload,
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      this.configService.getOrThrow<string>('JWT_ACCESS_EXPIRES'),
    );
  }

  /** Throws `UnauthorizedException` when the token is invalid or expired. */
  verifyAccessToken(token: string): AppJwtPayload {
    return this.verify(
      token,
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    );
  }

  verifyRefreshToken(token: string): AppJwtPayload {
    return this.verify(
      token,
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
    );
  }

  /**
   * When a refresh token signed now stops being valid. Mirrors
   * JWT_REFRESH_EXPIRES so a stored session row expires with the token it
   * tracks. Supports the `7d` / `12h` / `30m` / `3600` forms jsonwebtoken takes.
   */
  refreshTokenExpiresAt(): Date {
    const raw = this.configService
      .getOrThrow<string>('JWT_REFRESH_EXPIRES')
      .trim();
    const match = /^(\d+)\s*([smhd])?$/.exec(raw);

    if (!match) {
      throw new Error(`Unsupported JWT_REFRESH_EXPIRES value: ${raw}`);
    }

    const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    const unit = match[2] as keyof typeof unitMs | undefined;
    const ms = Number(match[1]) * (unit ? unitMs[unit] : 1_000);

    return new Date(Date.now() + ms);
  }

  private sign(
    payload: AppJwtPayload,
    secret: string,
    expiresIn: string,
    jwtid?: string,
  ): string {
    return jwt.sign(payload, secret, {
      expiresIn,
      ...(jwtid ? { jwtid } : {}),
    } as SignOptions);
  }

  private verify(token: string, secret: string): AppJwtPayload {
    try {
      return jwt.verify(token, secret) as AppJwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
