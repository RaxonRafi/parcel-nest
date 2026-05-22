import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtPayload } from 'jsonwebtoken';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { extractBearerToken, verifyToken } from '../../common/utils/jwt.util';
import { User } from '../../user/user.entity';
import { IsActive } from '../../user/user.interface';

export type RequestWithUser = Request & { user: User };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Authorization token required');
    }

    let verifiedToken: JwtPayload;

    try {
      verifiedToken = verifyToken(
        token,
        this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.userRepository.findOne({
      where: { email: verifiedToken.email as string },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.isDeleted) {
      throw new UnauthorizedException('User is deleted');
    }

    if (
      user.isActive === IsActive.BLOCKED ||
      user.isActive === IsActive.INACTIVE
    ) {
      throw new UnauthorizedException(`User is ${user.isActive}`);
    }

    request.user = user;
    return true;
  }
}
