import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../token/services/token.service';
import { User } from '../../user/entities/user.entity';
import { UserService } from '../../user/services/user.service';
import { sanitizeUser } from '../../user/utils/sanitize-user.util';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { LoginDto } from '../dto/login.dto';
import { AuthResponse, MessageResponse } from '../types/auth.types';

/**
 * Session concerns only. All user reads/writes go through `UserService`, and
 * all signing goes through `TokenService` — this service owns no repository.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
  ) {}

  async login(payload: LoginDto): Promise<AuthResponse> {
    const user = await this.userService.findByEmail(payload.email);

    if (
      !user ||
      !(await this.userService.verifyPassword(user, payload.password))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertCanSignIn(user);

    const tokens = this.tokenService.createUserTokens(user);
    return { user: sanitizeUser(user), ...tokens };
  }

  async refreshAccessToken(refreshToken: string): Promise<string> {
    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    const user = await this.userService.findByEmail(payload.email);

    if (!user) {
      throw new BadRequestException('User does not exist');
    }

    this.assertCanSignIn(user);

    return this.tokenService.signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
  }

  logout(): MessageResponse {
    return { message: 'Logged out successfully' };
  }

  async changePassword(
    user: User,
    payload: ChangePasswordDto,
  ): Promise<MessageResponse> {
    if (!user.password) {
      throw new BadRequestException(
        'Password change is not available for this account',
      );
    }

    const isCurrentPasswordValid = await this.userService.verifyPassword(
      user,
      payload.currentPassword,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.userService.setPassword(user, payload.newPassword);

    return { message: 'Password changed successfully' };
  }

  private assertCanSignIn(user: User): void {
    const blockReason = this.userService.getSignInBlockReason(user);

    if (blockReason) {
      throw new BadRequestException(blockReason);
    }
  }
}
