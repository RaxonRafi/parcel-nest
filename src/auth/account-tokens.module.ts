import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailVerification } from './entities/email-verification.entity';
import { PasswordReset } from './entities/password-reset.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { SessionService } from './services/session.service';

/**
 * The token-table services, split out of `AuthModule` so other modules can
 * record a session or send account emails without importing it.
 *
 * `AuthModule` → `AccessControlModule` → `UserModule`, so a `UserModule`
 * import of `AuthModule` would be a cycle. None of the services here depends
 * on `UserService` — they take a `User` entity — so this module has no such
 * edge. `SessionService` is here because registration issues a refresh token
 * and has to record it like login does.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PasswordReset, EmailVerification, RefreshToken]),
  ],
  providers: [PasswordResetService, EmailVerificationService, SessionService],
  exports: [PasswordResetService, EmailVerificationService, SessionService],
})
export class AccountTokensModule {}
