import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AccountTokensModule } from '../auth/account-tokens.module';
import { TokenModule } from '../token/token.module';
import { UserController } from './controllers/user.controller';
import { AuthProvider } from './entities/auth-provider.entity';
import { User } from './entities/user.entity';
import { UserService } from './services/user.service';

/**
 * Owns the user tables. The guards are declared locally rather than pulled in
 * from `AccessControlModule`, because that module imports this one.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuthProvider]),
    TokenModule,
    AccountTokensModule,
  ],
  controllers: [UserController],
  providers: [UserService, JwtAuthGuard, RolesGuard],
  exports: [UserService],
})
export class UserModule {}
