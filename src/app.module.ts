import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { UniqueViolationFilter } from './common/filters/unique-violation.filter';
import { THROTTLER_CONFIG } from './common/throttler.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ContactModule } from './contact/contact.module';
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
    // A lost race on a unique column answers 409 instead of a bare 500.
    { provide: APP_FILTER, useClass: UniqueViolationFilter },
  ],
})
export class AppModule {}
