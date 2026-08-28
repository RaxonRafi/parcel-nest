import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from '../config/database.config';

/**
 * Wires the same options the migration CLI uses into Nest, adding the
 * connection-retry behaviour that only applies at runtime.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildDataSourceOptions((key) => config.get<string>(key)),
        retryAttempts: 3,
        retryDelay: 5000,
      }),
    }),
  ],
})
export class DatabaseModule {}
