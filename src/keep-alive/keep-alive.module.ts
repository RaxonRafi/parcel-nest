import { Module } from '@nestjs/common';
import { AccountTokensModule } from '../auth/account-tokens.module';
import { KeepAliveController } from './controllers/keep-alive.controller';
import { KeepAliveService } from './services/keep-alive.service';

@Module({
  // For the token-table services the daily run prunes.
  imports: [AccountTokensModule],
  controllers: [KeepAliveController],
  providers: [KeepAliveService],
  exports: [KeepAliveService],
})
export class KeepAliveModule {}
