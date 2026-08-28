import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../common/access-control.module';
import { AuditController } from './controllers/audit.controller';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './services/audit.service';

/**
 * `AuditService` is exported for the feature modules that write to it;
 * `AuditRecorderModule` below is the import-safe half for modules that would
 * otherwise form a cycle through `AccessControlModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AccessControlModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
