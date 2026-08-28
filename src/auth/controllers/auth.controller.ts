import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JWT_AUTH } from '../../config/swagger.config';
import { User } from '../../user/entities/user.entity';
import {
  AccessTokenResponseDto,
  AuthResponseDto,
  MessageResponseDto,
} from '../dto/auth-response.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { AuthService } from '../services/auth.service';
import {
  AccessTokenResponse,
  AuthResponse,
  MessageResponse,
} from '../types/auth.types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: 'Log in',
    description:
      'Start here — copy `accessToken` from the response into the Authorize dialog.',
  })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Bad credentials or blocked account',
  })
  @Post('login')
  async login(@Body() payload: LoginDto): Promise<AuthResponse> {
    return this.authService.login(payload);
  }

  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  @ApiResponse({ status: 201, type: AccessTokenResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token invalid or expired' })
  @Post('refresh-token')
  async refreshAccessToken(
    @Body() body: RefreshTokenDto,
  ): Promise<AccessTokenResponse> {
    const accessToken = await this.authService.refreshAccessToken(
      body.refreshToken,
    );

    return { accessToken };
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Log out' })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(): MessageResponse {
    return this.authService.logout();
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Change the signed-in user password' })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @ApiResponse({ status: 401, description: 'Current password does not match' })
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: User,
    @Body() payload: ChangePasswordDto,
  ): Promise<MessageResponse> {
    return this.authService.changePassword(user, payload);
  }
}
