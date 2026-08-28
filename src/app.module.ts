import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { THROTTLER_CONFIG } from './common/throttler.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { KeepAliveModule } from './keep-alive/keep-alive.module';
import { MailModule } from './mail/mail.module';
import { ParcelModule } from './parcel/parcel.module';
import { RagModule } from './rag/rag.module';
import { TokenModule } from './token/token.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot(THROTTLER_CONFIG),
    DatabaseModule,
    MailModule,
    TokenModule,
    UserModule,
    AuthModule,
    ParcelModule,
    DashboardModule,
    RagModule,
    KeepAliveModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Applied globally; handlers opt into a tighter named throttle with
    // `@Throttle(...)`, or out entirely with `@SkipThrottle()`.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
