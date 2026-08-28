import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../token/services/token.service';
import { UserService } from '../../user/services/user.service';
import { extractBearerToken } from '../utils/jwt.util';
import { RequestWithUser } from '../types/request-with-user.type';

/**
 * Verifies the access token and attaches the matching user to the request.
 * The user is loaded through `UserService` — guards never touch repositories.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly userService: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Authorization token required');
    }

    const payload = this.tokenService.verifyAccessToken(token);
    const user = await this.userService.findByEmail(payload.email);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const blockReason = this.userService.getSignInBlockReason(user);

    if (blockReason) {
      throw new UnauthorizedException(blockReason);
    }

    request.user = user;
    return true;
  }
}
