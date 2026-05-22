import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/auth/auth.module';
import { DashboardModule } from '../src/dashboard/dashboard.module';
import { ParcelModule } from '../src/parcel/parcel.module';
import { UserModule } from '../src/user/user.module';

export const testEnv = {
  JWT_ACCESS_SECRET: 'test-access-secret-key',
  JWT_REFRESH_SECRET: 'test-refresh-secret-key',
  JWT_ACCESS_EXPIRES: '15m',
  JWT_REFRESH_EXPIRES: '7d',
  BCRYPT_SALT_ROUND: '4',
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [() => testEnv],
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: ':memory:',
      autoLoadEntities: true,
      synchronize: true,
    }),
    UserModule,
    AuthModule,
    ParcelModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class TestAppModule {}
