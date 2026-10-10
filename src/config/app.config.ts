import { INestApplication, ValidationPipe } from '@nestjs/common';

export const GLOBAL_PREFIX = 'api';

/**
 * Request handling shared by the real server and the e2e harness, so a test
 * exercises the same prefix and validation rules production does.
 */
export function configureApp(app: INestApplication): void {
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
