import { Module } from '@nestjs/common';
import { KeepAliveController } from './controllers/keep-alive.controller';
import { KeepAliveService } from './services/keep-alive.service';

@Module({
  controllers: [KeepAliveController],
  providers: [KeepAliveService],
  exports: [KeepAliveService],
})
export class KeepAliveModule {}
