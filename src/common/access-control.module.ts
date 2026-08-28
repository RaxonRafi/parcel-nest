import { Module } from '@nestjs/common';
import { TokenModule } from '../token/token.module';
import { UserModule } from '../user/user.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Bundles the request guards together with the providers they inject, so a
 * feature module only has to `imports: [AccessControlModule]` to be able to
 * use `@UseGuards(JwtAuthGuard, RolesGuard)` on its controllers.
 *
 * `UserModule` cannot import this module (that would be a cycle) — it declares
 * the guards itself instead.
 */
@Module({
  imports: [UserModule, TokenModule],
  providers: [JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, UserModule, TokenModule],
})
export class AccessControlModule {}
