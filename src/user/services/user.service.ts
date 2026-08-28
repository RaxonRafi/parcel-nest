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
import { ILike, Repository } from 'typeorm';
import { Paginated, paginate } from '../../common/types/paginated.type';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction, AuditTargetType } from '../../audit/types/audit.types';
import { EmailVerificationService } from '../../auth/services/email-verification.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { QueryUsersDto } from '../dto/query-users.dto';
import { extractBearerToken } from '../../common/utils/jwt.util';
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
    private readonly emailVerificationService: EmailVerificationService,
    private readonly auditService: AuditService,
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
      // Unverified until the emailed link is opened. `isVerified` used to be
      // hardcoded true, which made the column meaningless.
      isVerified: false,
      auths: [
        {
          provider: AuthProviderType.CREDENTIALS,
          providerId: email,
        },
      ],
      ...rest,
    });

    const saved = await this.userRepository.save(user);

    // Issued here rather than in `register` so an account created through any
    // path gets its confirmation link. Fire-and-forget: the service swallows
    // delivery failures, so a mail outage cannot fail account creation.
    await this.emailVerificationService.issue(saved);

    return saved;
  }

  /**
   * Looks up a parcel receiver, creating a placeholder account when the email
   * is not registered yet. Called by ParcelService.
   */
  async findOrCreateReceiver(
    payload: CreateReceiverDto,
  ): Promise<{ user: User; created: boolean }> {
    const email = payload.email.toLowerCase().trim();
    const existing = await this.userRepository.findOne({
      where: { email, isDeleted: false },
    });

    if (existing) {
      return { user: existing, created: false };
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

    return { user: await this.userRepository.save(receiver), created: true };
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

  async getAllUsers(query: QueryUsersDto): Promise<Paginated<SafeUser>> {
    const filters: Record<string, unknown> = { isDeleted: false };

    if (query.role) filters.role = query.role;
    if (query.isActive) filters.isActive = query.isActive;

    // An array of conditions is ORed, so one term can match name or email
    // while every other filter still applies to both branches.
    const where = query.search
      ? [
          { ...filters, name: ILike(`%${query.search}%`) },
          { ...filters, email: ILike(`%${query.search}%`) },
        ]
      : filters;

    const [users, total] = await this.userRepository.findAndCount({
      where: where as never,
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });

    return paginate(users.map(sanitizeUser), total, query.page, query.limit);
  }

  /** Couriers waiting on an admin decision. */
  async getPendingDeliveryPersonnel(
    query: PaginationQueryDto,
  ): Promise<Paginated<SafeUser>> {
    return this.findByRole(Role.PENDING_DELIVERY, query);
  }

  /** Approved couriers — the pool an admin assigns parcels from. */
  async getDeliveryPersonnel(
    query: PaginationQueryDto,
  ): Promise<Paginated<SafeUser>> {
    return this.findByRole(Role.DELIVERY_PERSONNEL, query);
  }

  /**
   * Resolves an approved courier, used by `ParcelService` before assigning a
   * parcel. Applicants still in `PENDING_DELIVERY` are rejected here — that is
   * the whole point of the approval step.
   */
  async findDeliveryPersonnelOrFail(id: string): Promise<User> {
    const user = await this.findEntityByIdOrFail(id);

    if (user.role !== Role.DELIVERY_PERSONNEL) {
      throw new BadRequestException(
        'User is not an approved delivery personnel',
      );
    }

    if (user.isActive !== IsActive.ACTIVE) {
      throw new BadRequestException(`Delivery personnel is ${user.isActive}`);
    }

    return user;
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

  async setUserActiveStatus(
    userId: string,
    active: boolean,
    actor?: User,
  ): Promise<SafeUser> {
    const user = await this.findEntityByIdOrFail(userId);
    const from = user.isActive;
    user.isActive = active ? IsActive.ACTIVE : IsActive.BLOCKED;
    const saved = await this.userRepository.save(user);

    if (actor) {
      await this.auditService.record({
        actor,
        action: active ? AuditAction.USER_UNBLOCKED : AuditAction.USER_BLOCKED,
        targetType: AuditTargetType.USER,
        targetId: user.id,
        summary: `${active ? 'Unblocked' : 'Blocked'} ${user.email}`,
        metadata: { from, to: saved.isActive },
      });
    }

    return sanitizeUser(saved);
  }

  /**
   * Resolves a `PENDING_DELIVERY` application. Approving promotes the account
   * to `DELIVERY_PERSONNEL`; rejecting drops it back to `SENDER` so the person
   * keeps a usable account and can re-apply.
   */
  async markVerified(userId: string): Promise<SafeUser> {
    const user = await this.findEntityByIdOrFail(userId);
    user.isVerified = true;
    return sanitizeUser(await this.userRepository.save(user));
  }

  async setDeliveryApproval(
    userId: string,
    approved: boolean,
    actor?: User,
  ): Promise<SafeUser> {
    const user = await this.findEntityByIdOrFail(userId);

    if (user.role !== Role.PENDING_DELIVERY) {
      throw new BadRequestException(
        'User has no pending delivery personnel application',
      );
    }

    const from = user.role;
    user.role = approved ? Role.DELIVERY_PERSONNEL : Role.SENDER;
    const saved = await this.userRepository.save(user);

    if (actor) {
      await this.auditService.record({
        actor,
        action: approved
          ? AuditAction.DELIVERY_APPROVED
          : AuditAction.DELIVERY_REJECTED,
        targetType: AuditTargetType.USER,
        targetId: user.id,
        summary: `${approved ? 'Approved' : 'Rejected'} courier application for ${user.email}`,
        metadata: { from, to: saved.role },
      });
    }

    return sanitizeUser(saved);
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

  private async findByRole(
    role: Role,
    query: PaginationQueryDto,
  ): Promise<Paginated<SafeUser>> {
    const [users, total] = await this.userRepository.findAndCount({
      where: { role, isDeleted: false },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });

    return paginate(users.map(sanitizeUser), total, query.page, query.limit);
  }

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
