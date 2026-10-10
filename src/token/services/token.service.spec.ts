import { ConfigService } from '@nestjs/config';
import { Role } from '../../user/types/user.types';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const env: Record<string, string> = {
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_ACCESS_EXPIRES: '15m',
    JWT_REFRESH_EXPIRES: '7d',
  };
  const service = new TokenService({
    getOrThrow: (key: string) => env[key],
  } as unknown as ConfigService);
  const user = { id: 'user-1', email: 'jane@example.com', role: Role.SENDER };

  it('never issues the same refresh token twice, even in one second', () => {
    const first = service.createUserTokens(user).refreshToken;
    const second = service.createUserTokens(user).refreshToken;

    expect(second).not.toBe(first);
    expect(service.verifyRefreshToken(second).email).toBe(user.email);
  });

  it('does not accept a refresh token as an access token', () => {
    const { refreshToken } = service.createUserTokens(user);

    expect(() => service.verifyAccessToken(refreshToken)).toThrow(
      'Invalid or expired token',
    );
  });

  it.each([
    ['7d', 7 * 86_400_000],
    ['12h', 12 * 3_600_000],
    ['30m', 30 * 60_000],
    ['3600', 3_600_000],
  ])('reads a %s refresh lifetime', (value, expectedMs) => {
    env.JWT_REFRESH_EXPIRES = value;
    const before = Date.now();

    const expiresAt = service.refreshTokenExpiresAt().getTime();

    expect(expiresAt - before).toBeGreaterThanOrEqual(expectedMs);
    expect(expiresAt - before).toBeLessThan(expectedMs + 5_000);
    env.JWT_REFRESH_EXPIRES = '7d';
  });
});
