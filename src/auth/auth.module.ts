import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../common/access-control.module';
import { AuthController } from './controllers/auth.controller';
import { PasswordReset } from './entities/password-reset.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuthService } from './services/auth.service';
import { PasswordResetService } from './services/password-reset.service';
import { SessionService } from './services/session.service';

@Module({
  imports: [
    AccessControlModule,
    TypeOrmModule.forFeature([RefreshToken, PasswordReset]),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordResetService],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
