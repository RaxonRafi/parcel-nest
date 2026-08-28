import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from '../../user/entities/user.entity';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { AuthService } from '../services/auth.service';
import {
  AccessTokenResponse,
  AuthResponse,
  MessageResponse,
} from '../types/auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() payload: LoginDto): Promise<AuthResponse> {
    return this.authService.login(payload);
  }

  @Post('refresh-token')
  async refreshAccessToken(
    @Body() body: RefreshTokenDto,
  ): Promise<AccessTokenResponse> {
    const accessToken = await this.authService.refreshAccessToken(
      body.refreshToken,
    );

    return { accessToken };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(): MessageResponse {
    return this.authService.logout();
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: User,
    @Body() payload: ChangePasswordDto,
  ): Promise<MessageResponse> {
    return this.authService.changePassword(user, payload);
  }
}
