import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { requestContext } from '../common/middleware/request-context.middleware';

export const GLOBAL_PREFIX = 'api';

/**
 * Request handling shared by the real server and the e2e harness, so a test
 * exercises the same prefix, headers and validation rules production does.
 */
export function configureApp(app: INestApplication): void {
  // First, so even a request that is rejected further down has an id.
  // Per-request log lines are noise in a test run.
  app.use(requestContext({ log: process.env.NODE_ENV !== 'test' }));

  app.use(
    helmet({
      // This is a JSON API; the only HTML it serves is Swagger UI, whose
      // production assets come from a CDN that a default CSP would block.
      contentSecurityPolicy: false,
      // The client lives on another origin and must be able to read responses.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      // Drop unknown keys instead of letting them reach a service, and reject
      // the request outright when the caller sends one — silently ignoring a
      // misspelled field is how bugs stay hidden.
      whitelist: true,
      forbidNonWhitelisted: true,
      // Bodies arrive as JSON, so payloads need converting to DTO instances
      // before class-validator's type checks mean anything.
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
}
