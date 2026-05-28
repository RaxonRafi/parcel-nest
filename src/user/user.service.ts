import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { JwtPayload } from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { AuthTokenService } from '../auth/auth-token.service';
import { extractBearerToken, verifyToken } from '../common/utils/jwt.util';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import {
  AuthResponse,
  SafeUser,
} from './interfaces/auth-response.interface';
import { User } from './user.entity';
import { AuthProviderType, IsActive, Role } from './user.interface';
import { sanitizeUser } from './utils/sanitize-user.util';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly authTokenService: AuthTokenService,
  ) {}

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
      console.log('Super Admin Already Exists!');
      return;
    }

    console.log('Trying to create Super Admin...');
    const hashedPassword = await bcrypt.hash(
      superAdminPassword,
      Number(this.configService.getOrThrow<string>('BCRYPT_SALT_ROUND')),
    );

    const superAdmin = this.userRepository.create({
      name: 'Super admin',
      role: Role.ADMIN,
      email: superAdminEmail,
      password: hashedPassword,
      isVerified: true,
      auths: [
        {
          provider: AuthProviderType.CREDENTIALS,
          providerId: superAdminEmail,
        },
      ],
    });

    await this.userRepository.save(superAdmin);
    console.log('Super Admin Created Successfully!');
  }

  async register(
    payload: CreateUserDto,
    authorization?: string,
  ): Promise<AuthResponse> {
    const registerPayload: CreateUserDto = {
      ...payload,
      role: authorization ? payload.role : Role.SENDER,
    };
    const user = await this.createUser(registerPayload, authorization);
    const tokens = this.authTokenService.createUserTokens(user);
    return { user: sanitizeUser(user), ...tokens };
  }

  async login(payload: LoginDto): Promise<AuthResponse> {
    const email = payload.email.toLowerCase().trim();
    const user = await this.userRepository.findOne({ where: { email } });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(
      payload.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertUserCanAuthenticate(user);

    const tokens = this.authTokenService.createUserTokens(user);
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
    const token = extractBearerToken(authorization);

    if (role === Role.ADMIN) {
      if (!token) {
        throw new UnauthorizedException(
          'Authorization token required to create admin!',
        );
      }

      const verifiedToken = verifyToken(
        token,
        this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ) as JwtPayload;

      const currentUser = await this.userRepository.findOne({
        where: { email: verifiedToken.email as string },
      });

      if (!currentUser || currentUser.role !== Role.ADMIN) {
        throw new UnauthorizedException('Unauthorized to create admin!');
      }
    }

    const isUserExists = await this.userRepository.exists({
      where: { email },
    });

    if (isUserExists) {
      throw new ConflictException('User already exists!!');
    }

    const userRole = this.resolveUserRole(role);
    const hashedPassword = await bcrypt.hash(
      password,
      Number(this.configService.getOrThrow<string>('BCRYPT_SALT_ROUND')),
    );

    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      role: userRole,
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

  async getUserById(id: string): Promise<SafeUser> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user || user.isDeleted) {
      throw new NotFoundException('User not found');
    }

    return sanitizeUser(user);
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

  async updateProfile(
    userId: string,
    payload: Partial<User>,
  ): Promise<SafeUser> {
    const allowedFields: (keyof User)[] = [
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
  ): Promise<SafeUser> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user || user.isDeleted) {
      throw new NotFoundException('User not found');
    }

    user.isActive = active ? IsActive.ACTIVE : IsActive.BLOCKED;
    const updated = await this.userRepository.save(user);
    return sanitizeUser(updated);
  }

  async updateUser(
    id: string,
    payload: Partial<User>,
    requester: User,
  ): Promise<SafeUser> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user || user.isDeleted) {
      throw new NotFoundException('User not found');
    }

    if (requester.id !== id && requester.role !== Role.ADMIN) {
      throw new UnauthorizedException('Unauthorized to update this user');
    }

    if (payload.email) {
      payload.email = payload.email.toLowerCase().trim();
    }

    if (payload.password) {
      payload.password = await bcrypt.hash(
        payload.password,
        Number(this.configService.getOrThrow<string>('BCRYPT_SALT_ROUND')),
      );
    }

    Object.assign(user, payload);
    const updated = await this.userRepository.save(user);
    return sanitizeUser(updated);
  }

  async softDeleteUser(id: string, requester: User): Promise<SafeUser> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user || user.isDeleted) {
      throw new NotFoundException('User not found');
    }

    if (requester.id !== id && requester.role !== Role.ADMIN) {
      throw new UnauthorizedException('Unauthorized to delete this user');
    }

    user.isDeleted = true;
    const deleted = await this.userRepository.save(user);
    return sanitizeUser(deleted);
  }

  private assertUserCanAuthenticate(user: User): void {
    if (user.isDeleted) {
      throw new BadRequestException('User is deleted');
    }

    if (
      user.isActive === IsActive.BLOCKED ||
      user.isActive === IsActive.INACTIVE
    ) {
      throw new BadRequestException(`User is ${user.isActive}`);
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
