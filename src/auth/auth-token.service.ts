import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtPayload } from 'jsonwebtoken';
import { Repository } from 'typeorm';
import {
  AppJwtPayload,
  generateToken,
  verifyToken,
} from '../common/utils/jwt.util';
import { User } from '../user/user.entity';
import { IsActive } from '../user/user.interface';

@Injectable()
export class AuthTokenService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  createUserTokens(user: Partial<User>): {
    accessToken: string;
    refreshToken: string;
  } {
    const jwtPayload: AppJwtPayload = {
      userId: user.id as string,
      email: user.email as string,
      role: user.role as AppJwtPayload['role'],
    };

    const accessToken = generateToken(
      jwtPayload,
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      this.configService.getOrThrow<string>('JWT_ACCESS_EXPIRES'),
    );

    const refreshToken = generateToken(
      jwtPayload,
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES'),
    );

    return { accessToken, refreshToken };
  }

  async createNewAccessTokenWithRefreshToken(
    refreshToken: string,
  ): Promise<string> {
    const verifiedRefreshToken = verifyToken(
      refreshToken,
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
    ) as JwtPayload;

    const isUserExist = await this.userRepository.findOne({
      where: { email: verifiedRefreshToken.email as string },
    });

    if (!isUserExist) {
      throw new BadRequestException('User does not exist');
    }

    if (
      isUserExist.isActive === IsActive.BLOCKED ||
      isUserExist.isActive === IsActive.INACTIVE
    ) {
      throw new BadRequestException(`User is ${isUserExist.isActive}`);
    }

    if (isUserExist.isDeleted) {
      throw new BadRequestException('User is deleted');
    }

    const jwtPayload: AppJwtPayload = {
      userId: isUserExist.id,
      email: isUserExist.email,
      role: isUserExist.role,
    };

    return generateToken(
      jwtPayload,
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      this.configService.getOrThrow<string>('JWT_ACCESS_EXPIRES'),
    );
  }
}
