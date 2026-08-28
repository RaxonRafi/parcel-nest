import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JWT_AUTH } from '../../config/swagger.config';
import { User } from '../../user/entities/user.entity';
import {
  AuthResponseDto,
  MessageResponseDto,
  TokenPairResponseDto,
} from '../dto/auth-response.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import { LogoutDto } from '../dto/logout.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { AuthService } from '../services/auth.service';
import { AuthResponse, MessageResponse } from '../types/auth.types';
import { TokenPair } from '../../token/types/token.types';

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
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('login')
  async login(@Body() payload: LoginDto): Promise<AuthResponse> {
    return this.authService.login(payload);
  }

  @ApiOperation({
    summary: 'Exchange a refresh token for a fresh pair',
    description:
      'Rotates the session: the token you send is revoked and a new pair returned, so store both from the response.',
  })
  @ApiResponse({ status: 201, type: TokenPairResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Token invalid, expired, or belongs to an ended session',
  })
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('refresh-token')
  async refreshAccessToken(@Body() body: RefreshTokenDto): Promise<TokenPair> {
    return this.authService.refreshAccessToken(body.refreshToken);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Log out',
    description:
      'Revokes the supplied refresh token, or every session for the user when the body is omitted. The access token remains valid until it expires (15 minutes).',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @CurrentUser() user: User,
    @Body() body: LogoutDto,
  ): Promise<MessageResponse> {
    return this.authService.logout(user, body.refreshToken);
  }

  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always reports success, whether or not the address has an account — anything else would let a caller enumerate registered users.',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
  ): Promise<MessageResponse> {
    return this.authService.forgotPassword(body.email);
  }

  @ApiOperation({
    summary: 'Set a new password using an emailed token',
    description:
      'The token is single-use and expires 30 minutes after it is issued. A successful reset ends every existing session.',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @ApiResponse({ status: 400, description: 'Token invalid, used, or expired' })
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(
    @Body() body: ResetPasswordDto,
  ): Promise<MessageResponse> {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @ApiOperation({
    summary: 'Confirm an email address',
    description:
      'Takes the token from the confirmation link. Single use, valid 24 hours.',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @ApiResponse({ status: 400, description: 'Token invalid, used, or expired' })
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('verify-email')
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<MessageResponse> {
    return this.authService.verifyEmail(body.token);
  }

  @ApiOperation({
    summary: 'Send another confirmation link',
    description:
      'Always reports success, whether or not the address has an unconfirmed account.',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('resend-verification')
  async resendVerification(
    @Body() body: ForgotPasswordDto,
  ): Promise<MessageResponse> {
    return this.authService.resendVerification(body.email);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Change the signed-in user password' })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @ApiResponse({ status: 401, description: 'Current password does not match' })
  @UseGuards(JwtAuthGuard)
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: User,
    @Body() payload: ChangePasswordDto,
  ): Promise<MessageResponse> {
    return this.authService.changePassword(user, payload);
  }
}
