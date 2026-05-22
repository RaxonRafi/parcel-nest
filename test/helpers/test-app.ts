import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { Repository } from 'typeorm';
import { TestAppModule, testEnv } from '../test-app.module';
import { AuthProvider } from '../../src/user/auth-provider.entity';
import { User } from '../../src/user/user.entity';
import { AuthProviderType, IsActive, Role } from '../../src/user/user.interface';

export interface SeededUsers {
  admin: User;
  sender: User;
  receiver: User;
  adminToken: string;
  senderToken: string;
  receiverToken: string;
  adminRefreshToken: string;
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

export async function seedUsers(app: INestApplication): Promise<SeededUsers> {
  const userRepository = app.get<Repository<User>>(getRepositoryToken(User));
  const passwordHash = await bcrypt.hash(
    'Password123!',
    Number(testEnv.BCRYPT_SALT_ROUND),
  );

  const createSeededUser = async (
    name: string,
    email: string,
    role: Role,
  ): Promise<User> => {
    const user = userRepository.create({
      name,
      email,
      password: passwordHash,
      role,
      isVerified: true,
      isActive: IsActive.ACTIVE,
      auths: [
        {
          provider: AuthProviderType.CREDENTIALS,
          providerId: email,
        } as AuthProvider,
      ],
    });
    return userRepository.save(user);
  };

  const admin = await createSeededUser('Admin User', 'admin@test.com', Role.ADMIN);
  const sender = await createSeededUser(
    'Sender User',
    'sender@test.com',
    Role.SENDER,
  );
  const receiver = await createSeededUser(
    'Receiver User',
    'receiver@test.com',
    Role.RECEIVER,
  );

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email,
        password: 'Password123!',
      })
      .expect(201);
    return response.body as {
      accessToken: string;
      refreshToken: string;
    };
  };

  const adminAuth = await login('admin@test.com');
  const senderAuth = await login('sender@test.com');
  const receiverAuth = await login('receiver@test.com');

  return {
    admin,
    sender,
    receiver,
    adminToken: adminAuth.accessToken,
    senderToken: senderAuth.accessToken,
    receiverToken: receiverAuth.accessToken,
    adminRefreshToken: adminAuth.refreshToken,
  };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
