import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { requestContext, requestIdOf } from './request-context.middleware';

describe('requestContext', () => {
  const UUID = /^[0-9a-f-]{36}$/;

  const run = (headers: Record<string, string> = {}, log = false) => {
    const req = {
      headers,
      method: 'GET',
      originalUrl: '/api/health',
    } as unknown as Request;
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: jest.fn(),
    });
    const next = jest.fn();

    requestContext({ log })(req, res as unknown as Response, next);

    return { req, res, next };
  };

  it('gives the request an id and returns it in a header', () => {
    const { req, res, next } = run();

    const id = requestIdOf(req);
    expect(id).toMatch(UUID);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
    expect(next).toHaveBeenCalled();
  });

  it('reuses an id a proxy or the client already assigned', () => {
    const { req } = run({ 'x-request-id': 'edge-7f3a.01' });

    expect(requestIdOf(req)).toBe('edge-7f3a.01');
  });

  it.each([['a b'], ['x'.repeat(65)], ['<script>'], ['line\nbreak']])(
    'replaces an unsafe supplied id (%p) rather than echo it',
    (supplied) => {
      const { req } = run({ 'x-request-id': supplied });

      expect(requestIdOf(req)).toMatch(UUID);
    },
  );

  describe('logging', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each([
      [200, 'log'],
      [404, 'warn'],
      [500, 'error'],
    ] as const)('logs a %i at %s level when it finishes', (status, level) => {
      const spy = jest.spyOn(Logger.prototype, level).mockImplementation();
      const { req, res } = run({}, true);

      res.statusCode = status;
      res.emit('finish');

      expect(spy).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`^GET /api/health ${status} \\d+ms \\[${requestIdOf(req)}\\]$`),
        ),
      );
    });

    it('stays quiet when logging is off', () => {
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { res } = run({}, false);

      res.emit('finish');

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
