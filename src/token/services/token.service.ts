import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  private sign(
    payload: AppJwtPayload,
    secret: string,
    expiresIn: string,
  ): string {
    return jwt.sign(payload, secret, { expiresIn } as SignOptions);
  }

  private verify(token: string, secret: string): AppJwtPayload {
    try {
      return jwt.verify(token, secret) as AppJwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
