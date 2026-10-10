import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './services/notification.service';

/**
 * `NotificationService` on its own, with no controller and therefore no
 * guards. Feature modules that only write notifications import this half, the
 * same split `AuditRecorderModule` makes for the audit trail.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationStoreModule {}
