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
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthResponse } from '../../auth/types/auth.types';
import { AuthResponseDto } from '../../auth/dto/auth-response.dto';
import { JWT_AUTH } from '../../config/swagger.config';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { User } from '../entities/user.entity';
import { SafeUser } from '../types/safe-user.type';
import { Role } from '../types/user.types';
import { UserService } from '../services/user.service';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({
    summary: 'Register an account',
    description:
      'Public. Creating a user with `role: ADMIN` additionally requires an admin bearer token in the `Authorization` header.',
  })
  @ApiHeader({
    name: 'authorization',
    required: false,
    description:
      'Admin bearer token — only needed when requesting `role: ADMIN`.',
  })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  @Post('register')
  async register(
    @Body() payload: CreateUserDto,
    @Headers('authorization') authorization?: string,
  ): Promise<AuthResponse> {
    return this.userService.register(payload, authorization);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Update your own profile' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @UseGuards(JwtAuthGuard)
  @Patch('update-profile')
  async updateProfile(
    @CurrentUser() user: User,
    @Body() payload: UpdateProfileDto,
  ): Promise<SafeUser> {
    return this.userService.updateProfile(user.id, payload);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Get the signed-in user' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@CurrentUser() user: User): Promise<SafeUser> {
    return this.userService.getProfile(user.id);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'List every user', description: 'Admin only.' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('all-users')
  async getAllUsers(): Promise<SafeUser[]> {
    return this.userService.getAllUsers();
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Get a user by id', description: 'Admin only.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'No such user' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get(':id')
  async getUserById(@Param('id') id: string): Promise<SafeUser> {
    return this.userService.getUserById(id);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Block a user', description: 'Admin only.' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':userId/block')
  async blockUser(@Param('userId') userId: string): Promise<SafeUser> {
    return this.userService.setUserActiveStatus(userId, false);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Unblock a user', description: 'Admin only.' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':userId/unblock')
  async unblockUser(@Param('userId') userId: string): Promise<SafeUser> {
    return this.userService.setUserActiveStatus(userId, true);
  }
}
