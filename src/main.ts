import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Request, RequestHandler, Response } from 'express';
import { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { THROTTLER_NAMES } from './common/throttler.config';
import { configureApp } from './config/app.config';
import { setupSwagger } from './config/swagger.config';
import { UserService } from './user/services/user.service';

const logger = new Logger('Bootstrap');

const DEFAULT_ORIGINS = [
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://percel-client-next.vercel.app',
];

/**
 * A browser hides every response header from cross-origin script unless it is
 * listed here, so without this the client gets the 429 but not how long to
 * wait. The throttler suffixes the header with the name of the limit that was
 * hit, except for `default`.
 */
const RATE_LIMIT_HEADERS = THROTTLER_NAMES.map((name) =>
  name === 'default' ? 'Retry-After' : `Retry-After-${name}`,
);

/** Memoised so concurrent cold-start requests share one boot. */
let appPromise: Promise<INestApplication> | undefined;

/** Applies the HTTP CORS allow-list to the Socket.IO handshake as well. */
class CorsIoAdapter extends IoAdapter {
  constructor(
    host: INestApplication,
    private readonly origins: string[],
  ) {
    super(host);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    }) as unknown;
  }
}

/** `a.com, b.com` is how people write lists; an origin with a space matches nothing. */
function corsOrigins(): string[] {
  const configured = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_ORIGINS;
}

/**
 * How many proxies sit in front of the app. Without it `req.ip` is the
 * proxy's address, so every client shares one rate-limit bucket. Left unset
 * off Vercel, because trusting `X-Forwarded-For` with no proxy in front lets
 * a client pick its own address.
 */
function trustedProxyHops(): number | undefined {
  const configured = process.env.TRUST_PROXY ?? (process.env.VERCEL ? '1' : '');
  const hops = Number(configured);

  return configured !== '' && Number.isInteger(hops) && hops > 0
    ? hops
    : undefined;
}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const hops = trustedProxyHops();
  if (hops) {
    app.set('trust proxy', hops);
  }

  const userService = app.get(UserService);
  await userService.seedSuperAdmin();

  configureApp(app);
  const origins = corsOrigins();
  app.enableCors({
    origin: origins,
    credentials: true,
    exposedHeaders: RATE_LIMIT_HEADERS,
  });
  app.useWebSocketAdapter(new CorsIoAdapter(app, origins));
  setupSwagger(app);

  // ✅ Local and long-running hosts: listen on a port. WebSockets need this —
  // a Vercel function cannot hold a connection open.
  if (!process.env.VERCEL) {
    await app.listen(process.env.PORT ?? 3000);
    logger.log(
      `🚀 Server running on http://localhost:${process.env.PORT ?? 3000}/api`,
    );
    logger.log(
      `📖 Swagger UI on http://localhost:${process.env.PORT ?? 3000}/api/docs`,
    );
  } else {
    await app.init(); // Vercel serverless
  }

  return app;
}

function bootstrap(): Promise<INestApplication> {
  appPromise ??= createApp().catch((error: unknown) => {
    // Forget the failed attempt so the next serverless invocation retries
    // instead of replaying the same rejection forever.
    appPromise = undefined;
    throw error;
  });

  return appPromise;
}

bootstrap().catch((error: unknown) => {
  logger.error(
    'Application failed to start',
    error instanceof Error ? error.stack : String(error),
  );

  // A long-running host should exit so its supervisor restarts it. On Vercel
  // the handler below retries the boot on the next request.
  if (!process.env.VERCEL) {
    process.exit(1);
  }
});

// ✅ Vercel serverless export
export default async (req: Request, res: Response): Promise<void> => {
  const server = await bootstrap();
  const handler = server.getHttpAdapter().getInstance() as RequestHandler;
  void handler(req, res, () => undefined);
};
