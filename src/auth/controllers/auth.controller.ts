import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JWT_AUTH } from '../../config/swagger.config';
import { RefreshCookieService } from '../../token/services/refresh-cookie.service';
import { User } from '../../user/entities/user.entity';
import {
  AuthResponseDto,
  MessageResponseDto,
  SessionResponseDto,
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
import {
  AuthResponse,
  MessageResponse,
  SessionContext,
  SessionSummary,
} from '../types/auth.types';
import { TokenPair } from '../../token/types/token.types';

/** What the session row remembers about where a sign-in came from. */
export function sessionContext(req: Request): SessionContext {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @ApiOperation({
    summary: 'Log in',
    description:
      'Start here — copy `accessToken` from the response into the Authorize dialog. The refresh token is also set as an `httpOnly` cookie. Five wrong passwords in a row lock the account for 15 minutes (`429`).',
  })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Bad credentials or blocked account',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limited, or the account is temporarily locked',
  })
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() payload: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Partial<AuthResponse>> {
    const result = await this.authService.login(payload, sessionContext(req));
    return this.refreshCookie.attach(res, result);
  }

  @ApiOperation({
    summary: 'Exchange a refresh token for a fresh pair',
    description:
      'Rotates the session: the token you send is revoked and a new pair returned, so store both from the response. The token is read from the body, or from the `refresh_token` cookie when the body has none. Presenting a token that was already rotated away ends every session in that chain.',
  })
  @ApiResponse({ status: 201, type: TokenPairResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Token missing, invalid, expired, or from an ended session',
  })
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('refresh-token')
  async refreshAccessToken(
    @Body() body: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Partial<TokenPair>> {
    const refreshToken = body?.refreshToken ?? this.refreshCookie.read(req);

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    try {
      const tokens = await this.authService.refreshAccessToken(
        refreshToken,
        sessionContext(req),
      );
      return this.refreshCookie.attach(res, tokens);
    } catch (error) {
      // A dead cookie would otherwise be sent, and refused, on every refresh.
      this.refreshCookie.clear(res);
      throw error;
    }
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Log out',
    description:
      'Ends one session: the one whose refresh token is in the body, or else the one in the `refresh_token` cookie. With neither — or with `everywhere: true` — every session for the user ends. The access token remains valid until it expires (15 minutes).',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @CurrentUser() user: User,
    @Body() body: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponse> {
    // Express leaves the body undefined when none is sent.
    const refreshToken = body?.everywhere
      ? undefined
      : (body?.refreshToken ?? this.refreshCookie.read(req));

    this.refreshCookie.clear(res);
    return this.authService.logout(user, refreshToken);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'List your signed-in devices',
    description:
      'One entry per live session, newest first. `current` is true for the session this request belongs to, which is only known when the `refresh_token` cookie is sent.',
  })
  @ApiResponse({ status: 200, type: [SessionResponseDto] })
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  listSessions(
    @CurrentUser() user: User,
    @Req() req: Request,
  ): Promise<SessionSummary[]> {
    return this.authService.listSessions(user, this.refreshCookie.read(req));
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Sign one device out',
    description: 'Ends the session with this id. Only your own sessions.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 404, description: 'No such live session of yours' })
  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  endSession(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MessageResponse> {
    return this.authService.endSession(user, id);
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
      'The token is single-use and expires 30 minutes after it is issued. A successful reset ends every existing session and lifts a sign-in lock.',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Token invalid, used or expired, or the password is too weak',
  })
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponse> {
    const result = await this.authService.changePassword(user, payload);
    // Every session just ended, this one included.
    this.refreshCookie.clear(res);
    return result;
  }
}
