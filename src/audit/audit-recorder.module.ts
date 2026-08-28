import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './services/audit.service';

/**
 * `AuditService` on its own, with no controller and no `AccessControlModule`.
 *
 * `UserModule` needs to write audit entries, but `AuditModule` imports
 * `AccessControlModule`, which imports `UserModule` — importing the full module
 * there would be a cycle. This half only needs the repository.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditRecorderModule {}
