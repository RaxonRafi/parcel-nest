import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UserService } from './user/services/user.service';

let app;

async function bootstrap() {
  if (app) return app;

  app = await NestFactory.create(AppModule);

  const userService = app.get(UserService);
  await userService.seedSuperAdmin();

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? [
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'https://percel-client-next.vercel.app',
    ],
    credentials: true,
  });

  // ✅ Local: listen on port
  if (process.env.NODE_ENV !== 'production') {
    await app.listen(process.env.PORT ?? 3000);
    console.log(
      `🚀 Server running on http://localhost:${process.env.PORT ?? 3000}/api`,
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
