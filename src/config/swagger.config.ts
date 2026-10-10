import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Named security scheme — matches the string passed to `@ApiBearerAuth()`. */
export const JWT_AUTH = 'jwt';

/**
 * Swagger UI is served at `/api/docs` (the global `api` prefix is already
 * applied, so the path here is absolute).
 *
 * Vercel builds `src/main.ts` with `@vercel/node` rather than `nest build`,
 * so the Swagger CLI plugin never runs there and schemas come from explicit
 * `@ApiProperty()` decorators instead. For the same reason the UI assets are
 * pulled from a CDN in production — `swagger-ui-dist` is not reliably part of
 * the serverless bundle.
 *
 * Two switches gate it, both off by default so an existing deploy keeps its
 * docs:
 * - `SWAGGER_ENABLED=false` does not mount it at all.
 * - `SWAGGER_USER` + `SWAGGER_PASSWORD` put HTTP Basic auth in front of the
 *   UI and the JSON document.
 */
export function setupSwagger(app: INestApplication): void {
  if (process.env.SWAGGER_ENABLED?.trim().toLowerCase() === 'false') {
    new Logger('Swagger').log('Disabled by SWAGGER_ENABLED=false');
    return;
  }

  const user = process.env.SWAGGER_USER;
  const password = process.env.SWAGGER_PASSWORD;
  if (user && password) {
    app.use(['/api/docs', '/api/docs-json'], basicAuth(user, password));
  }

  const config = new DocumentBuilder()
    .setTitle('Parcel Delivery API')
    .setDescription(
      [
        'Parcel management, user accounts and RAG-backed search.',
        '',
        '**Testing a protected route:** call `POST /api/auth/login`, copy the',
        '`accessToken` from the response, then hit **Authorize** and paste it.',
        'The token is remembered across page reloads.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token returned by `POST /api/auth/login`.',
      },
      JWT_AUTH,
    )
    .addTag('Auth', 'Login, logout, token refresh and password changes')
    .addTag('Users', 'Registration, profile and admin user management')
    .addTag('Parcels', 'Create, track and move parcels through their lifecycle')
    .addTag('Dashboard', 'Admin-only aggregate statistics')
    .addTag('Audit', 'Admin-only trail of privileged actions')
    .addTag('RAG', 'Document ingestion and question answering')
    .addTag('Contact', 'Public contact form')
    .addTag('Notifications', 'The signed-in user’s notification inbox')
    .addTag('System', 'Health and scheduled keep-alive')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const isProduction = process.env.NODE_ENV === 'production';
  const CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5';

  SwaggerModule.setup('api/docs', app, document, {
    useGlobalPrefix: false,
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'Parcel Delivery API',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    ...(isProduction
      ? {
          customCssUrl: `${CDN}/swagger-ui.min.css`,
          customJs: [
            `${CDN}/swagger-ui-bundle.js`,
            `${CDN}/swagger-ui-standalone-preset.js`,
          ],
        }
      : {}),
  });
}

/** Constant-time on both halves, so a wrong guess learns nothing from timing. */
function basicAuth(user: string, password: string) {
  const expected = Buffer.from(`${user}:${password}`);

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const received = header.startsWith('Basic ')
      ? Buffer.from(header.slice(6), 'base64')
      : Buffer.alloc(0);

    if (
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    ) {
      next();
      return;
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="API docs"');
    res.status(401).send('Authentication required');
  };
}
