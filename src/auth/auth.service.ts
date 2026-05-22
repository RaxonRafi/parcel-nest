import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  logout(): { message: string } {
    return { message: 'Logged out successfully' };
  }

  async changePassword(
    user: User,
    payload: ChangePasswordDto,
  ): Promise<{ message: string }> {
    if (!user.password) {
      throw new BadRequestException(
        'Password change is not available for this account',
      );
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      payload.currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.password = await bcrypt.hash(
      payload.newPassword,
      Number(this.configService.getOrThrow<string>('BCRYPT_SALT_ROUND')),
    );

    await this.userRepository.save(user);

    return { message: 'Password changed successfully' };
  }
}
