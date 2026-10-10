import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { TokenPair } from '../types/token.types';
import { TokenService } from './token.service';

export const REFRESH_COOKIE = 'refresh_token';

/** Only the session routes ever need it, so it is sent nowhere else. */
const COOKIE_PATH = '/api/auth';

/**
 * Carries the refresh token in an `httpOnly` cookie.
 *
 * A token in the JSON body ends up wherever the client keeps it — usually
 * `localStorage`, where any script on the page can read it. A cookie the
 * browser will not show to JavaScript takes that whole class of theft away.
 *
 * The body still carries the token unless `REFRESH_TOKEN_IN_BODY=false`, so a
 * client that has not moved to the cookie keeps working; switch it off once
 * the client sends requests with credentials.
 */
@Injectable()
export class RefreshCookieService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Sets the cookie and returns what the body should contain: the same
   * payload, with the refresh token removed when the body is switched off.
   */
  attach<T extends TokenPair>(
    res: Response,
    result: T,
  ): T | Omit<T, 'refreshToken'> {
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...this.options(),
      expires: this.tokenService.refreshTokenExpiresAt(),
    });

    if (this.tokenInBody) return result;

    const { refreshToken: _refreshToken, ...rest } = result;
    return rest;
  }

  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.options());
  }

  /** Parsed by hand: one cookie does not justify a parser dependency. */
  read(req: Request): string | undefined {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;

      if (part.slice(0, separator).trim() === REFRESH_COOKIE) {
        const value = part.slice(separator + 1).trim();
        try {
          return decodeURIComponent(value) || undefined;
        } catch {
          return undefined;
        }
      }
    }

    return undefined;
  }

  private get tokenInBody(): boolean {
    return (
      this.config.get<string>('REFRESH_TOKEN_IN_BODY')?.trim().toLowerCase() !==
      'false'
    );
  }

  /**
   * The client is on a different site from the API in production, and a
   * browser only sends a cookie cross-site when it is `SameSite=None; Secure`.
   * Locally both are on `localhost` over plain HTTP, where `Secure` would stop
   * the cookie being stored at all.
   */
  private options(): CookieOptions {
    const secure =
      this.config.get<string>('NODE_ENV') === 'production' ||
      !!this.config.get<string>('VERCEL');

    return {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: COOKIE_PATH,
    };
  }
}
