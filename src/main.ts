import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UserService } from './user/user.service';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const userService = app.get(UserService);

  await userService.seedSuperAdmin();

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? [
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'https://percel-client-next.vercel.app'
      
    ],
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
