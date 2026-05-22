import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { LoginDto } from '../user/dto/login.dto';
import {
  AccessTokenResponse,
  AuthResponse,
} from '../user/interfaces/auth-response.interface';
import { User } from '../user/user.entity';
import { UserService } from '../user/user.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly authTokenService: AuthTokenService,
  ) {}

  @Post('login')
  async login(@Body() payload: LoginDto): Promise<AuthResponse> {
    return this.userService.login(payload);
  }

  @Post('refresh-token')
  async refreshAccessToken(
    @Body() body: RefreshTokenDto,
  ): Promise<AccessTokenResponse> {
    const accessToken =
      await this.authTokenService.createNewAccessTokenWithRefreshToken(
        body.refreshToken,
      );

    return { accessToken };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(): { message: string } {
    return this.authService.logout();
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: User,
    @Body() payload: ChangePasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.changePassword(user, payload);
  }
}
