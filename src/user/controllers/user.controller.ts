import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
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
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthResponse } from '../../auth/types/auth.types';
import {
  AuthResponseDto,
  MessageResponseDto,
} from '../../auth/dto/auth-response.dto';
import { MessageResponse } from '../../auth/types/auth.types';
import { JWT_AUTH } from '../../config/swagger.config';
import { RefreshCookieService } from '../../token/services/refresh-cookie.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Paginated } from '../../common/types/paginated.type';
import { AdminUpdateUserDto } from '../dto/admin-update-user.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { DeleteAccountDto } from '../dto/delete-account.dto';
import { QueryUsersDto } from '../dto/query-users.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { PaginatedUsersDto, UserResponseDto } from '../dto/user-response.dto';
import { User } from '../entities/user.entity';
import { SafeUser } from '../types/safe-user.type';
import { Role } from '../types/user.types';
import { UserService } from '../services/user.service';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

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
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() payload: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('authorization') authorization?: string,
  ): Promise<Partial<AuthResponse>> {
    const result = await this.userService.register(payload, authorization);

    // An admin creating another admin is not signing in as them.
    return authorization ? result : this.refreshCookie.attach(res, result);
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
  @ApiOperation({
    summary: 'Delete your own account',
    description:
      'Needs your current password. The account can no longer sign in and every session ends at once; parcels and history that refer to it are kept. The email address stays reserved.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 401, description: 'Password does not match' })
  @ApiResponse({ status: 403, description: 'The super admin cannot be deleted' })
  @UseGuards(JwtAuthGuard)
  @Throttle({ auth: { limit: 8, ttl: 60_000 } })
  @Delete('me')
  async deleteOwnAccount(
    @CurrentUser() user: User,
    @Body() payload: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponse> {
    await this.userService.deleteOwnAccount(user, payload.password);
    this.refreshCookie.clear(res);
    return { message: 'Your account has been deleted' };
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'List every user', description: 'Admin only.' })
  @ApiResponse({ status: 200, type: PaginatedUsersDto })
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('all-users')
  async getAllUsers(
    @Query() query: QueryUsersDto,
  ): Promise<Paginated<SafeUser>> {
    return this.userService.getAllUsers(query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'List courier applicants',
    description: 'Admin only. Accounts sitting in `PENDING_DELIVERY`.',
  })
  @ApiResponse({ status: 200, type: PaginatedUsersDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('delivery/pending')
  async getPendingDeliveryPersonnel(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SafeUser>> {
    return this.userService.getPendingDeliveryPersonnel(query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'List approved couriers',
    description: 'Admin only. The pool to pick from when assigning a parcel.',
  })
  @ApiResponse({ status: 200, type: PaginatedUsersDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('delivery')
  async getDeliveryPersonnel(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SafeUser>> {
    return this.userService.getDeliveryPersonnel(query);
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
  @ApiOperation({
    summary: 'Edit a user',
    description:
      'Admin only. Name, contact details, national ID, role and the verified flag. Email and password are not editable here. Recorded in the audit trail.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Changing your own role, or the super admin’s',
  })
  @ApiResponse({ status: 404, description: 'No such user' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id')
  async adminUpdateUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() payload: AdminUpdateUserDto,
    @CurrentUser() actor: User,
  ): Promise<SafeUser> {
    return this.userService.adminUpdateUser(id, payload, actor);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Delete a user',
    description:
      'Admin only. Soft delete: the account can no longer sign in and its sessions end, but parcels and history that refer to it are kept. Recorded in the audit trail.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Deleting yourself here, or the super admin',
  })
  @ApiResponse({ status: 404, description: 'No such user' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete(':id')
  async adminDeleteUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: User,
  ): Promise<MessageResponse> {
    await this.userService.adminDeleteUser(id, actor);
    return { message: 'User deleted' };
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Block a user', description: 'Admin only.' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':userId/block')
  async blockUser(
    @Param('userId') userId: string,
    @CurrentUser() actor: User,
  ): Promise<SafeUser> {
    return this.userService.setUserActiveStatus(userId, false, actor);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({ summary: 'Unblock a user', description: 'Admin only.' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':userId/unblock')
  async unblockUser(
    @Param('userId') userId: string,
    @CurrentUser() actor: User,
  ): Promise<SafeUser> {
    return this.userService.setUserActiveStatus(userId, true, actor);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Approve a courier application',
    description:
      'Admin only. Promotes `PENDING_DELIVERY` to `DELIVERY_PERSONNEL` and emails the applicant. Refused until the applicant has a national ID number and a photo of it on their profile.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'User has no pending application, or the application has no national ID number and photo',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':userId/delivery/approve')
  async approveDeliveryPersonnel(
    @Param('userId') userId: string,
    @CurrentUser() actor: User,
  ): Promise<SafeUser> {
    return this.userService.setDeliveryApproval(userId, true, actor);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Reject a courier application',
    description:
      'Admin only. Drops the account back to `SENDER`, so the person keeps a usable account and can re-apply. The applicant is emailed the decision.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'User has no pending application' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':userId/delivery/reject')
  async rejectDeliveryPersonnel(
    @Param('userId') userId: string,
    @CurrentUser() actor: User,
  ): Promise<SafeUser> {
    return this.userService.setDeliveryApproval(userId, false, actor);
  }
}
