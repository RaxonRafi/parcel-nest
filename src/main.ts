import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './config/swagger.config';
import { UserService } from './user/services/user.service';

let app: INestApplication | undefined;

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
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? [
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'https://percel-client-next.vercel.app',
    ],
    credentials: true,
  });
  setupSwagger(app);

  // ✅ Local: listen on port
  if (process.env.NODE_ENV !== 'production') {
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
