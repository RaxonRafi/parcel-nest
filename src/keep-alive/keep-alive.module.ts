import { Module } from '@nestjs/common';
import { AccountTokensModule } from '../auth/account-tokens.module';
import { NotificationStoreModule } from '../notification/notification-store.module';
import { KeepAliveController } from './controllers/keep-alive.controller';
import { KeepAliveService } from './services/keep-alive.service';

@Module({
  // For the tables the daily run prunes.
  imports: [AccountTokensModule, NotificationStoreModule],
  controllers: [KeepAliveController],
  providers: [KeepAliveService],
  exports: [KeepAliveService],
})
export class KeepAliveModule {}
