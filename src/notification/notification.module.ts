import { Module } from '@nestjs/common';
import { AccessControlModule } from '../common/access-control.module';
import { NotificationController } from './controllers/notification.controller';
import { NotificationStoreModule } from './notification-store.module';

/** The inbox routes. Writers import `NotificationStoreModule` instead. */
@Module({
  imports: [AccessControlModule, NotificationStoreModule],
  controllers: [NotificationController],
})
export class NotificationModule {}
