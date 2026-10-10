import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BackgroundModule } from './common/background/background.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { throttlerOptions } from './common/throttler.config';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ContactModule } from './contact/contact.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { KeepAliveModule } from './keep-alive/keep-alive.module';
import { MailModule } from './mail/mail.module';
import { NotificationModule } from './notification/notification.module';
import { ParcelModule } from './parcel/parcel.module';
import { RagModule } from './rag/rag.module';
import { TokenModule } from './token/token.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    // Validated here so a missing secret stops the boot, instead of failing
    // the first request that happens to need it.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        throttlerOptions(config.get<string>('REDIS_URL')),
    }),
    DatabaseModule,
    BackgroundModule,
    MailModule,
    TokenModule,
    UserModule,
    AuthModule,
    ParcelModule,
    NotificationModule,
    DashboardModule,
    AuditModule,
    RagModule,
    ContactModule,
    KeepAliveModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Applied globally; handlers opt into a tighter named throttle with
    // `@Throttle(...)`, or out entirely with `@SkipThrottle()`.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Unique-constraint races answer 409; anything unexpected is logged with
    // a request id and answered with a bare 500.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
