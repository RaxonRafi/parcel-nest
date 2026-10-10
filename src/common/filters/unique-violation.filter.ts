import { ArgumentsHost, Catch, ConflictException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

interface DriverError {
  code?: string;
  detail?: string;
}

/**
 * Turns a unique-constraint failure into `409 Conflict`.
 *
 * Services check for duplicates before writing, but two requests can pass
 * that check together, and some unique columns (`nidNumber`) have no check at
 * all. Without this the loser of the race gets a bare `500`.
 */
@Catch(QueryFailedError)
export class UniqueViolationFilter extends BaseExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const driverError = exception.driverError as DriverError | undefined;

    if (driverError?.code !== UNIQUE_VIOLATION) {
      super.catch(exception, host);
      return;
    }

    // Postgres reports `Key (email)=(a@b.c) already exists.` — name the column
    // but never echo the value back.
    const column = /Key \("?([\w]+)"?\)/.exec(driverError.detail ?? '')?.[1];

    super.catch(
      new ConflictException(
        column
          ? `That ${column} is already in use`
          : 'That value is already in use',
      ),
      host,
    );
  }
}
