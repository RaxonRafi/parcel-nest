import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Server } from 'http';
import { Repository } from 'typeorm';
import { configureApp } from '../../src/config/app.config';
import { TokenService } from '../../src/token/services/token.service';
import { User } from '../../src/user/entities/user.entity';
import {
  AuthProviderType,
  IsActive,
  Role,
} from '../../src/user/types/user.types';
import { testEnv, TestAppModule } from '../test-app.module';

export const TEST_PASSWORD = 'Password123!';

export interface SeededUser {
  user: User;
  /** A valid access token, minted directly so seeding spends no login quota. */
  token: string;
}

export interface SeededUsers {
  admin: SeededUser;
  sender: SeededUser;
  /** A second SENDER account, used as a parcel receiver. */
  otherSender: SeededUser;
  receiver: SeededUser;
  courier: SeededUser;
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();

  return app;
}

/** Typed handle supertest can take without an `any` in between. */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

export async function seedUsers(app: INestApplication): Promise<SeededUsers> {
  const userRepository = app.get<Repository<User>>(getRepositoryToken(User));
  const tokenService = app.get(TokenService);
  const passwordHash = await bcrypt.hash(
    TEST_PASSWORD,
    Number(testEnv.BCRYPT_SALT_ROUND),
  );

  const seed = async (
    name: string,
    email: string,
    role: Role,
  ): Promise<SeededUser> => {
    const user = await userRepository.save(
      userRepository.create({
        name,
        email,
        password: passwordHash,
        role,
        isVerified: true,
        isActive: IsActive.ACTIVE,
        auths: [{ provider: AuthProviderType.CREDENTIALS, providerId: email }],
      }),
    );

    return { user, token: tokenService.createUserTokens(user).accessToken };
  };

  return {
    admin: await seed('Admin User', 'admin@test.com', Role.ADMIN),
    sender: await seed('Sender User', 'sender@test.com', Role.SENDER),
    otherSender: await seed('Other Sender', 'other@test.com', Role.SENDER),
    receiver: await seed('Receiver User', 'receiver@test.com', Role.RECEIVER),
    courier: await seed(
      'Cal Courier',
      'courier@test.com',
      Role.DELIVERY_PERSONNEL,
    ),
  };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
