import { Module } from '@nestjs/common';
import { AccessControlModule } from '../common/access-control.module';
import { AccountTokensModule } from './account-tokens.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';

@Module({
  imports: [AccessControlModule, AccountTokensModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, AccountTokensModule],
})
export class AuthModule {}
