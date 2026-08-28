import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { extractBearerToken } from '../../../common/utils/jwt.util';
import { TokenService } from '../../token/services/token.service';
import { AuthResponse } from '../../auth/types/auth.types';
import { CreateReceiverDto } from '../dto/create-receiver.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { User } from '../entities/user.entity';
import { SafeUser } from '../types/safe-user.type';
import {
  AuthProviderType,
  IsActive,
  Role,
  UserStats,
} from '../types/user.types';
import { sanitizeUser } from '../utils/sanitize-user.util';

/**
 * Sole owner of the `users` / `auth_providers` tables. Every other module goes
 * through this service instead of injecting the repositories itself.
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
  ) {}

  // ─── Bootstrapping ────────────────────────────────────────────────────────

  async seedSuperAdmin(): Promise<void> {
    const superAdminEmail = this.configService
      .get<string>('SUPER_ADMIN_EMAIL')
      ?.toLowerCase()
      .trim();
    const superAdminPassword = this.configService.get<string>(
      'SUPER_ADMIN_PASSWORD',
    );

    if (!superAdminEmail || !superAdminPassword) {
      return;
    }

    const isSuperAdminExist = await this.userRepository.findOne({
      where: { email: superAdminEmail },
    });

    if (isSuperAdminExist) {
      this.logger.log('Super Admin already exists');
      return;
    }

    this.logger.log('Creating Super Admin...');
    const superAdmin = this.userRepository.create({
      name: 'Super admin',
      role: Role.ADMIN,
      email: superAdminEmail,
      password: await this.hashPassword(superAdminPassword),
      isVerified: true,
      auths: [
        {
          provider: AuthProviderType.CREDENTIALS,
          providerId: superAdminEmail,
        },
      ],
    });

    await this.userRepository.save(superAdmin);
    this.logger.log('Super Admin created successfully');
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  async register(
    payload: CreateUserDto,
    authorization?: string,
  ): Promise<AuthResponse> {
    const registerPayload: CreateUserDto = {
      ...payload,
      role: authorization ? payload.role : Role.SENDER,
    };
    const user = await this.createUser(registerPayload, authorization);
    const tokens = this.tokenService.createUserTokens(user);
    return { user: sanitizeUser(user), ...tokens };
  }

  async createUser(
    payload: CreateUserDto | Partial<User>,
    authorization?: string,
  ): Promise<User> {
    const { email: rawEmail, password, role, ...rest } = payload;

    if (!rawEmail || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const email = rawEmail.toLowerCase().trim();

    if (role === Role.ADMIN) {
      await this.assertRequesterIsAdmin(authorization);
    }

    const isUserExists = await this.userRepository.exists({ where: { email } });

    if (isUserExists) {
      throw new ConflictException('User already exists!!');
    }

    const user = this.userRepository.create({
      email,
      password: await this.hashPassword(password),
      role: this.resolveUserRole(role),
      isVerified: true,
      auths: [
        {
          provider: AuthProviderType.CREDENTIALS,
          providerId: email,
        },
      ],
      ...rest,
    });

    return this.userRepository.save(user);
  }

  /**
   * Looks up a parcel receiver, creating a placeholder account when the email
   * is not registered yet. Called by ParcelService.
   */
  async findOrCreateReceiver(payload: CreateReceiverDto): Promise<User> {
    const email = payload.email.toLowerCase().trim();
    const existing = await this.userRepository.findOne({
      where: { email, isDeleted: false },
    });

    if (existing) {
      return existing;
    }

    const receiver = this.userRepository.create({
      name: payload.name,
      email,
      phone: payload.phone,
      role: Role.RECEIVER,
      isVerified: false,
      isActive: IsActive.ACTIVE,
      isDeleted: false,
    });

    return this.userRepository.save(receiver);
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  /** Full entity (password included) — for internal callers such as guards. */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async findEntityByIdOrFail(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user || user.isDeleted) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getUserById(id: string): Promise<SafeUser> {
    return sanitizeUser(await this.findEntityByIdOrFail(id));
  }

  async getProfile(userId: string): Promise<SafeUser> {
    return this.getUserById(userId);
  }

  async getAllUsers(): Promise<SafeUser[]> {
    const users = await this.userRepository.find({
      where: { isDeleted: false },
      order: { createdAt: 'DESC' },
    });
    return users.map(sanitizeUser);
  }

  async getStats(): Promise<UserStats> {
    const [totalUsers, activeUsers, blockedUsers] = await Promise.all([
      this.userRepository.count({ where: { isDeleted: false } }),
      this.userRepository.count({
        where: { isDeleted: false, isActive: IsActive.ACTIVE },
      }),
      this.userRepository.count({
        where: { isDeleted: false, isActive: IsActive.BLOCKED },
      }),
    ]);

    return { totalUsers, activeUsers, blockedUsers };
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

  async updateProfile(
    userId: string,
    payload: UpdateProfileDto,
  ): Promise<SafeUser> {
    const allowedFields: (keyof UpdateProfileDto)[] = [
      'name',
      'phone',
      'picture',
      'address',
      'nidNumber',
      'nidImage',
    ];

    const updates: Partial<User> = {};
    for (const field of allowedFields) {
      if (payload[field] !== undefined) {
        (updates as Record<string, unknown>)[field] = payload[field];
      }
    }

    return this.updateUser(userId, updates, { id: userId } as User);
  }

  async setUserActiveStatus(userId: string, active: boolean): Promise<SafeUser> {
    const user = await this.findEntityByIdOrFail(userId);
    user.isActive = active ? IsActive.ACTIVE : IsActive.BLOCKED;
    return sanitizeUser(await this.userRepository.save(user));
  }

  async updateUser(
    id: string,
    payload: Partial<User>,
    requester: User,
  ): Promise<SafeUser> {
    const user = await this.findEntityByIdOrFail(id);

    if (requester.id !== id && requester.role !== Role.ADMIN) {
      throw new UnauthorizedException('Unauthorized to update this user');
    }

    if (payload.email) {
      payload.email = payload.email.toLowerCase().trim();
    }

    if (payload.password) {
      payload.password = await this.hashPassword(payload.password);
    }

    Object.assign(user, payload);
    return sanitizeUser(await this.userRepository.save(user));
  }

  async softDeleteUser(id: string, requester: User): Promise<SafeUser> {
    const user = await this.findEntityByIdOrFail(id);

    if (requester.id !== id && requester.role !== Role.ADMIN) {
      throw new UnauthorizedException('Unauthorized to delete this user');
    }

    user.isDeleted = true;
    return sanitizeUser(await this.userRepository.save(user));
  }

  // ─── Credentials ──────────────────────────────────────────────────────────

  async verifyPassword(user: User, plainPassword: string): Promise<boolean> {
    if (!user.password) return false;
    return bcrypt.compare(plainPassword, user.password);
  }

  async setPassword(user: User, plainPassword: string): Promise<void> {
    user.password = await this.hashPassword(plainPassword);
    await this.userRepository.save(user);
  }

  /**
   * Returns why the account may not sign in, or null when it may. Callers
   * decide which HTTP status fits their context.
   */
  getSignInBlockReason(user: User): string | null {
    if (user.isDeleted) {
      return 'User is deleted';
    }

    if (
      user.isActive === IsActive.BLOCKED ||
      user.isActive === IsActive.INACTIVE
    ) {
      return `User is ${user.isActive}`;
    }

    return null;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async hashPassword(plainPassword: string): Promise<string> {
    return bcrypt.hash(
      plainPassword,
      Number(this.configService.getOrThrow<string>('BCRYPT_SALT_ROUND')),
    );
  }

  private async assertRequesterIsAdmin(authorization?: string): Promise<void> {
    const token = extractBearerToken(authorization);

    if (!token) {
      throw new UnauthorizedException(
        'Authorization token required to create admin!',
      );
    }

    const payload = this.tokenService.verifyAccessToken(token);
    const currentUser = await this.findByEmail(payload.email);

    if (!currentUser || currentUser.role !== Role.ADMIN) {
      throw new UnauthorizedException('Unauthorized to create admin!');
    }
  }

  private resolveUserRole(role?: Role): Role {
    if (role === Role.ADMIN) {
      return Role.ADMIN;
    }
    if (role === Role.SENDER || role === Role.RECEIVER) {
      return role;
    }
    if (role === Role.DELIVERY_PERSONNEL) {
      return Role.PENDING_DELIVERY;
    }
    return Role.SENDER;
  }
}
