import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
 */
export function setupSwagger(app: INestApplication): void {
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
    .addTag('RAG', 'Document ingestion and question answering')
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
