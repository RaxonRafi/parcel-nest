import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataType, newDb } from 'pg-mem';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuditModule } from '../src/audit/audit.module';
import { AuthModule } from '../src/auth/auth.module';
import { BackgroundModule } from '../src/common/background/background.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { THROTTLER_CONFIG } from '../src/common/throttler.config';
import { ENTITIES } from '../src/config/database.config';
import { ContactModule } from '../src/contact/contact.module';
import { DashboardModule } from '../src/dashboard/dashboard.module';
import { KeepAliveModule } from '../src/keep-alive/keep-alive.module';
import { MailModule } from '../src/mail/mail.module';
import { NotificationModule } from '../src/notification/notification.module';
import { ParcelModule } from '../src/parcel/parcel.module';
import { RagModule } from '../src/rag/rag.module';
import { TokenModule } from '../src/token/token.module';
import { UserModule } from '../src/user/user.module';

export const testEnv = {
  JWT_ACCESS_SECRET: 'test-access-secret-key',
  JWT_REFRESH_SECRET: 'test-refresh-secret-key',
  JWT_ACCESS_EXPIRES: '15m',
  JWT_REFRESH_EXPIRES: '7d',
  BCRYPT_SALT_ROUND: '4',
  SUPER_ADMIN_EMAIL: 'root@test.com',
  CRON_SECRET: 'test-cron-secret',
};

/**
 * An in-memory Postgres. The entities use `timestamptz`, `jsonb` and `numeric`,
 * which SQLite cannot hold, so the suite needs something that speaks Postgres
 * without needing a server to be running.
 */
async function createInMemoryDataSource(
  options?: DataSourceOptions,
): Promise<DataSource> {
  const db = newDb({ autoCreateForeignKeyIndices: true });

  // TypeORM asks for these while connecting and synchronising the schema.
  db.public.registerFunction({
    name: 'current_database',
    returns: DataType.text,
    implementation: () => 'test',
  });
  db.public.registerFunction({
    name: 'version',
    returns: DataType.text,
    implementation: () => 'PostgreSQL 16.0',
  });
  db.registerExtension('uuid-ossp', (schema) => {
    schema.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      implementation: randomUUID,
      impure: true,
    });
  });

  const dataSource = db.adapters.createTypeormDataSource(options) as DataSource;
  return dataSource.initialize();
}

/**
 * The real feature modules and the real global guard and filter, wired to the
 * in-memory database. No mail, RAG or Supabase credentials are provided:
 * mail logs instead of sending and the assistant reports itself disabled.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      ignoreEnvVars: true,
      load: [() => testEnv],
    }),
    ThrottlerModule.forRoot(THROTTLER_CONFIG),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        entities: ENTITIES,
        synchronize: true,
      }),
      dataSourceFactory: createInMemoryDataSource,
    }),
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class TestAppModule {}
