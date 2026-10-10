import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RefreshCookieService } from './refresh-cookie.service';
import { TokenService } from './token.service';

describe('RefreshCookieService', () => {
  const expires = new Date('2026-12-01T00:00:00Z');
  const pair = { accessToken: 'access', refreshToken: 'refresh' };
  let env: Record<string, string | undefined>;
  let service: RefreshCookieService;
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(() => {
    env = {};
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    service = new RefreshCookieService(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      { refreshTokenExpiresAt: () => expires } as unknown as TokenService,
    );
  });

  const attach = () => service.attach(res as unknown as Response, pair);
  const withCookie = (cookie?: string) =>
    ({ headers: { cookie } }) as unknown as Request;

  it('sets a cookie script cannot read, scoped to the session routes', () => {
    attach();

    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/auth',
      expires,
    });
  });

  it('goes cross-site and Secure in production, where the client is on another origin', () => {
    env.NODE_ENV = 'production';

    attach();

    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh',
      expect.objectContaining({ secure: true, sameSite: 'none' }),
    );
  });

  it('keeps the token in the body by default, so an older client still works', () => {
    expect(attach()).toEqual(pair);
  });

  it('leaves it out of the body once the server is told to', () => {
    env.REFRESH_TOKEN_IN_BODY = 'false';

    expect(attach()).toEqual({ accessToken: 'access' });
    expect(res.cookie).toHaveBeenCalled();
  });

  it('clears with the same attributes it set, or the browser keeps the cookie', () => {
    service.clear(res as unknown as Response);

    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/auth',
    });
  });

  it.each([
    ['refresh_token=abc.def.ghi', 'abc.def.ghi'],
    ['theme=dark; refresh_token=abc.def.ghi; other=1', 'abc.def.ghi'],
    ['refresh_token=a%20b', 'a b'],
    ['not_refresh_token=nope', undefined],
    ['refresh_token=', undefined],
    ['refresh_token=%E0%A4%A', undefined],
    [undefined, undefined],
  ])('reads %p as %p', (header, expected) => {
    expect(service.read(withCookie(header))).toBe(expected);
  });
});
