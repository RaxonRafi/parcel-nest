import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { User } from './user.entity';
import { AuthProvider } from './auth-provider.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuthProvider]),
    forwardRef(() => AuthModule),
  ],
  providers: [UserService, RolesGuard],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
