import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailVerification } from './entities/email-verification.entity';
import { PasswordReset } from './entities/password-reset.entity';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';

/**
 * The two single-use grant services, split out of `AuthModule` so other
 * modules can send account emails without importing it.
 *
 * `AuthModule` → `AccessControlModule` → `UserModule`, so a `UserModule`
 * import of `AuthModule` would be a cycle. Neither service here depends on
 * `UserService` — they take a `User` entity — so this module has no such edge.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PasswordReset, EmailVerification])],
  providers: [PasswordResetService, EmailVerificationService],
  exports: [PasswordResetService, EmailVerificationService],
})
export class AccountTokensModule {}
