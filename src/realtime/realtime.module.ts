import { Module } from '@nestjs/common';
import { AccessControlModule } from '../common/access-control.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@Module({
  // For `TokenService` and `UserService`, which the handshake check needs.
  imports: [AccessControlModule],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
