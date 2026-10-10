import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** A caller-supplied id is echoed only if it is short and plain. */
const SAFE_ID = /^[\w.-]{1,64}$/;

type RequestWithId = Request & { requestId?: string };

export function requestIdOf(request: Request): string | undefined {
  return (request as RequestWithId).requestId;
}

/**
 * Gives every request an id, returns it in `X-Request-Id`, and logs one line
 * when the response is finished.
 *
 * The id is what ties a user's "it said something went wrong" to a line in the
 * logs: the 500 body carries it, and so does the error the filter logged. An
 * id sent by a proxy or the client is reused so a trace can span both sides.
 *
 * Plain middleware rather than an interceptor, so it also covers requests
 * that never reach a handler — 404s, CORS preflights and throttled calls.
 */
export function requestContext(
  options: { log: boolean } = { log: true },
): (req: Request, res: Response, next: NextFunction) => void {
  const logger = new Logger('HTTP');

  return (req, res, next) => {
    const supplied = req.headers[REQUEST_ID_HEADER.toLowerCase()];
    const id =
      typeof supplied === 'string' && SAFE_ID.test(supplied)
        ? supplied
        : randomUUID();

    (req as RequestWithId).requestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);

    if (options.log) {
      const startedAt = process.hrtime.bigint();

      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms [${id}]`;

        if (res.statusCode >= 500) logger.error(line);
        else if (res.statusCode >= 400) logger.warn(line);
        else logger.log(line);
      });
    }

    next();
  };
}
