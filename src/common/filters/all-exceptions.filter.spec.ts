import {
  ArgumentsHost,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let passedOn: jest.SpyInstance;
  let logged: jest.SpyInstance;
  let response: {
    headersSent: boolean;
    status: jest.Mock;
    json: jest.Mock;
    end: jest.Mock;
  };
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // What Nest itself would have done with the exception.
    passedOn = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation();
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    response = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/api/parcels',
          requestId: 'req-42',
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const uniqueViolation = (detail?: string) =>
    new QueryFailedError('INSERT', [], {
      code: '23505',
      detail,
    } as unknown as Error);

  it('leaves an HttpException exactly as Nest answers it', () => {
    const notFound = new NotFoundException('Parcel not found');

    filter.catch(notFound, host);

    expect(passedOn).toHaveBeenCalledWith(notFound, host);
    expect(response.status).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });

  it('turns a unique violation into 409, naming the column but not the value', () => {
    filter.catch(
      uniqueViolation('Key (email)=(jane@example.com) already exists.'),
      host,
    );

    const [answered] = passedOn.mock.calls[0] as [HttpException];
    expect(answered).toBeInstanceOf(ConflictException);
    expect(answered.message).toBe('That email is already in use');
    expect(answered.message).not.toContain('jane@example.com');
  });

  it('still answers 409 when Postgres gives no detail', () => {
    filter.catch(uniqueViolation(), host);

    const [answered] = passedOn.mock.calls[0] as [HttpException];
    expect(answered.message).toBe('That value is already in use');
  });

  it('answers anything else with a bare 500 carrying the request id', () => {
    filter.catch(new Error('connection terminated: password=hunter2'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      requestId: 'req-42',
    });
    // The detail goes to the log, with the same id, and nowhere else.
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('hunter2');
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('req-42'),
      expect.any(String),
    );
  });

  it('treats another database error as a bug, not a conflict', () => {
    filter.catch(
      new QueryFailedError('SELECT', [], { code: '42P01' } as unknown as Error),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('only ends a response that has already started streaming', () => {
    response.headersSent = true;

    filter.catch(new Error('model timed out'), host);

    expect(response.end).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });
});
