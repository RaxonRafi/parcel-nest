import {
  ArgumentsHost,
  Catch,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { requestIdOf } from '../middleware/request-context.middleware';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

interface DriverError {
  code?: string;
  detail?: string;
}

/**
 * The one global exception filter.
 *
 * - An `HttpException` is answered exactly as Nest would answer it.
 * - A unique-constraint failure becomes `409 Conflict`. Services check for
 *   duplicates before writing, but two requests can pass that check together,
 *   and some unique columns (`nidNumber`) have no check at all. Without this
 *   the loser of the race gets a bare `500`.
 * - Anything else is a bug or an outage. It is logged with its stack and the
 *   request id, and the caller gets a `500` carrying that same id and nothing
 *   about what went wrong inside.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }

    const conflict = toConflict(exception);
    if (conflict) {
      super.catch(conflict, host);
      return;
    }

    if (host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = requestIdOf(request);

    this.logger.error(
      `${request.method} ${request.originalUrl} [${requestId ?? 'no-id'}] — ${
        exception instanceof Error ? exception.message : String(exception)
      }`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // The response may already be streaming (`rag/ask/stream`); a second
    // status line would throw and mask the original error.
    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      ...(requestId ? { requestId } : {}),
    });
  }
}

function toConflict(exception: unknown): ConflictException | null {
  if (!(exception instanceof QueryFailedError)) return null;

  const driverError = exception.driverError as DriverError | undefined;
  if (driverError?.code !== UNIQUE_VIOLATION) return null;

  // Postgres reports `Key (email)=(a@b.c) already exists.` — name the column
  // but never echo the value back.
  const column = /Key \("?([\w]+)"?\)/.exec(driverError.detail ?? '')?.[1];

  return new ConflictException(
    column ? `That ${column} is already in use` : 'That value is already in use',
  );
}
