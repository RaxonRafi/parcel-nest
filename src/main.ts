import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { setupSwagger } from './config/swagger.config';
import { UserService } from './user/services/user.service';

let app: INestApplication | undefined;

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

async function bootstrap(): Promise<INestApplication> {
  if (app) return app;

  app = await NestFactory.create(AppModule);

  const userService = app.get(UserService);
  await userService.seedSuperAdmin();

  app.setGlobalPrefix('api');
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
  const origins = process.env.CORS_ORIGIN?.split(',') ?? [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'https://percel-client-next.vercel.app',
  ];
  app.enableCors({ origin: origins, credentials: true });
  app.useWebSocketAdapter(new CorsIoAdapter(app, origins));
  setupSwagger(app);

  // ✅ Local and long-running hosts: listen on a port. WebSockets need this —
  // a Vercel function cannot hold a connection open.
  if (!process.env.VERCEL) {
    await app.listen(process.env.PORT ?? 3000);
    console.log(
      `🚀 Server running on http://localhost:${process.env.PORT ?? 3000}/api`,
    );
    console.log(
      `📖 Swagger UI on http://localhost:${process.env.PORT ?? 3000}/api/docs`,
    );
  } else {
    await app.init(); // Vercel serverless
  }

  return app;
}

bootstrap();

// ✅ Vercel serverless export
export default async (req: any, res: any) => {
  const server = await bootstrap();
  const httpAdapter = server.getHttpAdapter().getInstance();
  httpAdapter(req, res);
};
