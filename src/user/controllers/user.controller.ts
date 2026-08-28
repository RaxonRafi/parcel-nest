import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthResponse } from '../../auth/types/auth.types';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { User } from '../entities/user.entity';
import { SafeUser } from '../types/safe-user.type';
import { Role } from '../types/user.types';
import { UserService } from '../services/user.service';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('register')
  async register(
    @Body() payload: CreateUserDto,
    @Headers('authorization') authorization?: string,
  ): Promise<AuthResponse> {
    return this.userService.register(payload, authorization);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('update-profile')
  async updateProfile(
    @CurrentUser() user: User,
    @Body() payload: UpdateProfileDto,
  ): Promise<SafeUser> {
    return this.userService.updateProfile(user.id, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@CurrentUser() user: User): Promise<SafeUser> {
    return this.userService.getProfile(user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('all-users')
  async getAllUsers(): Promise<SafeUser[]> {
    return this.userService.getAllUsers();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get(':id')
  async getUserById(@Param('id') id: string): Promise<SafeUser> {
    return this.userService.getUserById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':userId/block')
  async blockUser(@Param('userId') userId: string): Promise<SafeUser> {
    return this.userService.setUserActiveStatus(userId, false);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':userId/unblock')
  async unblockUser(@Param('userId') userId: string): Promise<SafeUser> {
    return this.userService.setUserActiveStatus(userId, true);
  }
}
