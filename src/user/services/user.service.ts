import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { ILike, Repository } from 'typeorm';
import { escapeLike } from '../../common/utils/like.util';
import { webBaseUrl } from '../../common/utils/web-url.util';
import { MailService } from '../../mail/services/mail.service';
import { courierDecisionTemplate } from '../../mail/templates/account.template';
import { Paginated, paginate } from '../../common/types/paginated.type';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction, AuditTargetType } from '../../audit/types/audit.types';
import { EmailVerificationService } from '../../auth/services/email-verification.service';
import { SessionService } from '../../auth/services/session.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { QueryUsersDto } from '../dto/query-users.dto';
import { extractBearerToken } from '../../common/utils/jwt.util';
import { TokenService } from '../../token/services/token.service';
import { AuthResponse } from '../../auth/types/auth.types';
import { AdminUpdateUserDto } from '../dto/admin-update-user.dto';
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
import { UserEventsService } from './user-events.service';

/** Wrong passwords in a row before the account stops taking attempts. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

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
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    private readonly userEvents: UserEventsService,
    private readonly mailService: MailService,
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
    // The requested role is honoured as sent. `createUser` is what guards
    // it: ADMIN needs an admin's token, and DELIVERY_PERSONNEL is parked in
    // PENDING_DELIVERY until an admin approves the application.
    const user = await this.createUser(payload, authorization);
    const tokens = this.tokenService.createUserTokens(user);
    // Without a recorded session the refresh token is rejected the first
    // time it is used, signing the new user out when the access token expires.
    await this.sessionService.record(
      user,
      tokens.refreshToken,
      this.tokenService.refreshTokenExpiresAt(),
    );
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
    // Looked up regardless of `isDeleted`: the email column is unique, so a
    // deleted account still owns the address and inserting over it would fail.
    const existing = await this.userRepository.findOne({ where: { email } });

    if (existing) {
      this.assertCanReceive(existing);
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

  /** A parcel cannot be addressed to an account that can no longer sign in. */
  assertCanReceive(user: User): void {
    if (this.getSignInBlockReason(user)) {
      throw new BadRequestException(
        'That receiver account is not available — use a different receiver',
      );
    }
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
    const term = query.search ? `%${escapeLike(query.search)}%` : null;
    const where = term
      ? [
          { ...filters, name: ILike(term) },
          { ...filters, email: ILike(term) },
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

  /**
   * Ids of every account with a role that can still sign in — who a
   * role-wide notification is addressed to.
   */
  async findActiveIdsByRole(role: Role): Promise<string[]> {
    const users = await this.userRepository.find({
      select: { id: true },
      where: { role, isDeleted: false, isActive: IsActive.ACTIVE },
    });

    return users.map((user) => user.id);
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
      'emailNotifications',
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

    if (!active) {
      this.assertMayBeBlocked(user, actor);
    }

    const from = user.isActive;
    user.isActive = active ? IsActive.ACTIVE : IsActive.BLOCKED;
    const saved = await this.userRepository.save(user);

    if (!active) {
      // The guard already refuses a blocked user's access token; this ends
      // the refresh tokens and open sockets that would otherwise linger.
      await this.sessionService.revokeAllForUser(user.id);
      this.userEvents.announceAccessRevoked(user.id);
    }

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

    if (approved) {
      this.assertApplicationComplete(user);
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

    const { subject, html, text } = courierDecisionTemplate(
      saved.name,
      approved,
      `${webBaseUrl(this.configService)}/dashboard`,
    );
    this.mailService.queue(saved.email, subject, html, text);

    return sanitizeUser(saved);
  }

  /**
   * An admin edit to someone else's account. Role changes carry two guards:
   * an admin demoting themselves, or anyone demoting the super admin, can
   * leave nobody able to undo it.
   */
  async adminUpdateUser(
    id: string,
    payload: AdminUpdateUserDto,
    actor: User,
  ): Promise<SafeUser> {
    const user = await this.findEntityByIdOrFail(id);

    if (payload.role !== undefined && payload.role !== user.role) {
      if (actor.id === user.id) {
        throw new ForbiddenException('You cannot change your own role');
      }
      if (this.isSuperAdmin(user)) {
        throw new ForbiddenException(
          'The super admin’s role cannot be changed',
        );
      }
    }

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, value] of Object.entries(payload)) {
      const key = field as keyof AdminUpdateUserDto;
      if (value === undefined || isSameValue(user[key], value)) continue;

      changed[key] = { from: user[key], to: value };
      (user as unknown as Record<string, unknown>)[key] = value;
    }

    if (Object.keys(changed).length === 0) {
      return sanitizeUser(user);
    }

    const saved = await this.userRepository.save(user);
    await this.auditService.record({
      actor,
      action: AuditAction.USER_UPDATED,
      targetType: AuditTargetType.USER,
      targetId: user.id,
      summary: `Updated ${Object.keys(changed).join(', ')} for ${user.email}`,
      metadata: changed,
    });

    return sanitizeUser(saved);
  }

  /**
   * "Delete my account". The password is asked for again because the access
   * token alone only proves someone holds the device.
   */
  async deleteOwnAccount(user: User, password: string): Promise<void> {
    if (!(await this.verifyPassword(user, password))) {
      throw new UnauthorizedException('Password is incorrect');
    }

    await this.removeAccount(user, user);
  }

  /** An admin removing someone else's account. */
  async adminDeleteUser(id: string, actor: User): Promise<void> {
    if (actor.id === id) {
      throw new ForbiddenException(
        'Delete your own account from your profile, with your password',
      );
    }

    await this.removeAccount(await this.findEntityByIdOrFail(id), actor);
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

  // ─── Sign-in lockout ──────────────────────────────────────────────────────

  /** Milliseconds until the account takes sign-in attempts again, or 0. */
  lockRemainingMs(user: User): number {
    return Math.max(0, (user.lockedUntil?.getTime() ?? 0) - Date.now());
  }

  /**
   * Counts a wrong password and, at the limit, locks the account for a while.
   *
   * The route throttle is per IP, so it does nothing against guesses spread
   * over many addresses; this is per account. The counter restarts with each
   * lock, so a guesser gets `MAX_FAILED_LOGINS` tries per window and no more.
   */
  async recordFailedLogin(user: User): Promise<void> {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;

    if (attempts >= MAX_FAILED_LOGINS) {
      await this.userRepository.update(user.id, {
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
      });
      this.logger.warn(
        `Locked ${user.email} for ${LOCKOUT_MINUTES} minutes after ${attempts} failed sign-ins`,
      );
      return;
    }

    await this.userRepository.update(user.id, {
      failedLoginAttempts: attempts,
    });
  }

  /** A successful sign-in, or a completed reset, wipes the slate. */
  async clearFailedLogins(user: User): Promise<void> {
    if (!user.failedLoginAttempts && !user.lockedUntil) return;

    await this.userRepository.update(user.id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }

  // ─── Policy ───────────────────────────────────────────────────────────────

  /** Off unless `REQUIRE_VERIFIED_EMAIL=true` — see `assertEmailVerified`. */
  get requiresVerifiedEmail(): boolean {
    return (
      this.configService
        .get<string>('REQUIRE_VERIFIED_EMAIL')
        ?.trim()
        .toLowerCase() === 'true'
    );
  }

  /**
   * Refuses an account that has not confirmed its address.
   *
   * Opt-in, because it only makes sense once mail is actually being
   * delivered: with SMTP unconfigured nobody can receive the link, and every
   * account that predates verification would be locked out of booking.
   */
  assertEmailVerified(user: User, action: string): void {
    if (this.requiresVerifiedEmail && !user.isVerified) {
      throw new ForbiddenException(
        `Confirm your email address before ${action} — check your inbox, or request a new link`,
      );
    }
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

  /**
   * An admin locking themselves out, or locking out the seeded super admin,
   * can leave the system with nobody able to undo it.
   */
  private assertMayBeBlocked(target: User, actor?: User): void {
    if (actor && actor.id === target.id) {
      throw new ForbiddenException('You cannot block your own account');
    }

    if (this.isSuperAdmin(target)) {
      throw new ForbiddenException('The super admin cannot be blocked');
    }
  }

  private isSuperAdmin(user: User): boolean {
    const superAdminEmail = this.configService
      .get<string>('SUPER_ADMIN_EMAIL')
      ?.toLowerCase()
      .trim();

    return !!superAdminEmail && user.email === superAdminEmail;
  }

  /**
   * A courier handles other people's parcels and cash, so the identity check
   * is not optional: the application needs the ID an admin is approving.
   */
  private assertApplicationComplete(applicant: User): void {
    if (!applicant.nidNumber || !applicant.nidImage?.length) {
      throw new BadRequestException(
        'This applicant has not provided a national ID number and a photo of it — they need to complete their profile before they can be approved',
      );
    }

    if (this.requiresVerifiedEmail && !applicant.isVerified) {
      throw new BadRequestException(
        'This applicant has not confirmed their email address yet',
      );
    }
  }

  /**
   * Soft delete: the row stays, because parcels and audit entries point at
   * it, but the account can no longer sign in and its sessions end now.
   */
  private async removeAccount(target: User, actor: User): Promise<void> {
    if (this.isSuperAdmin(target)) {
      throw new ForbiddenException('The super admin cannot be deleted');
    }

    target.isDeleted = true;
    await this.userRepository.save(target);
    await this.sessionService.revokeAllForUser(target.id, 'security');
    this.userEvents.announceAccessRevoked(target.id);

    await this.auditService.record({
      actor,
      action: AuditAction.USER_DELETED,
      targetType: AuditTargetType.USER,
      targetId: target.id,
      summary:
        actor.id === target.id
          ? `${target.email} deleted their own account`
          : `Deleted ${target.email}`,
      metadata: { role: target.role, self: actor.id === target.id },
    });
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

/** Arrays (`nidImage`) compare by content; everything else by identity. */
function isSameValue(current: unknown, next: unknown): boolean {
  if (Array.isArray(current) && Array.isArray(next)) {
    return (
      current.length === next.length &&
      current.every((value, index) => value === next[index])
    );
  }

  return current === next;
}
