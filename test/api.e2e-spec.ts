import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ParcelStatus } from '../src/parcel/types/parcel.types';
import {
  authHeader,
  createTestApp,
  seedUsers,
  SeededUsers,
} from './helpers/test-app';

describe('API (e2e)', () => {
  let app: INestApplication;
  let users: SeededUsers;
  let trackingId: string;
  let newSenderId: string;

  beforeAll(async () => {
    app = await createTestApp();
    users = await seedUsers(app);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Health', () => {
    it('GET /api (root)', async () => {
      await request(app.getHttpServer()).get('/api').expect(200);
    });
  });

  describe('Auth', () => {
    it('POST /api/auth/login', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'sender@test.com', password: 'Password123!' })
        .expect(201);

      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        user: expect.objectContaining({ email: 'sender@test.com' }),
      });
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('POST /api/auth/refresh-token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh-token')
        .send({ refreshToken: users.adminRefreshToken })
        .expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('POST /api/auth/change-password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set(authHeader(users.senderToken))
        .send({
          currentPassword: 'Password123!',
          newPassword: 'NewPassword123!',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'sender@test.com', password: 'NewPassword123!' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set(authHeader(users.senderToken))
        .send({
          currentPassword: 'NewPassword123!',
          newPassword: 'Password123!',
        })
        .expect(201);
    });

    it('POST /api/auth/logout', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set(authHeader(users.adminToken))
        .expect(201);

      expect(res.body.message).toBe('Logged out successfully');
    });
  });

  describe('Users', () => {
    it('POST /api/users/register', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users/register')
        .send({
          name: 'New Sender',
          email: 'newsender@test.com',
          password: 'Password123!',
        })
        .expect(201);

      expect(res.body.user.role).toBe('SENDER');
      expect(res.body.accessToken).toBeDefined();
      newSenderId = res.body.user.id;
    });

    it('GET /api/users/me', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set(authHeader(users.receiverToken))
        .expect(200);

      expect(res.body.email).toBe('receiver@test.com');
    });

    it('PATCH /api/users/update-profile', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/users/update-profile')
        .set(authHeader(users.receiverToken))
        .send({ phone: '01700000000' })
        .expect(200);

      expect(res.body.phone).toBe('01700000000');
    });

    it('GET /api/users/all-users', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/all-users')
        .set(authHeader(users.adminToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
    });

    it('GET /api/users/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/users/${users.sender.id}`)
        .set(authHeader(users.adminToken))
        .expect(200);

      expect(res.body.id).toBe(users.sender.id);
    });

    it('PATCH /api/users/:userId/block and unblock', async () => {
      await request(app.getHttpServer())
        .patch(`/api/users/${newSenderId}/block`)
        .set(authHeader(users.adminToken))
        .expect(200)
        .expect((res) => {
          expect(res.body.isActive).toBe('BLOCKED');
        });

      await request(app.getHttpServer())
        .patch(`/api/users/${newSenderId}/unblock`)
        .set(authHeader(users.adminToken))
        .expect(200)
        .expect((res) => {
          expect(res.body.isActive).toBe('ACTIVE');
        });
    });
  });

  describe('Parcels', () => {
    it('POST /api/parcels', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/parcels')
        .set(authHeader(users.senderToken))
        .send({
          receiverId: users.receiver.id,
          receiverName: users.receiver.name,
          receiverPhone: '01711111111',
          pickupAddress: 'Dhaka Pickup',
          deliveryAddress: 'Chittagong Delivery',
          description: 'Test parcel',
        })
        .expect(201);

      trackingId = res.body.trackingId;
      expect(trackingId).toMatch(/^TRK-/);
      expect(res.body.status).toBe(ParcelStatus.PENDING);
    });

    it('PATCH /api/parcels/:trackingId/status', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/parcels/${trackingId}/status`)
        .set(authHeader(users.adminToken))
        .send({ status: ParcelStatus.IN_TRANSIT, note: 'Shipped' })
        .expect(200);

      expect(res.body.status).toBe(ParcelStatus.IN_TRANSIT);
    });

    it('GET /api/parcels/my-parcels', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/parcels/my-parcels')
        .set(authHeader(users.senderToken))
        .expect(200);

      expect(
        res.body.some(
          (p: { trackingId: string }) => p.trackingId === trackingId,
        ),
      ).toBe(true);
    });

    it('GET /api/parcels/incoming-parcels', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/parcels/incoming-parcels')
        .set(authHeader(users.receiverToken))
        .expect(200);

      expect(
        res.body.some(
          (p: { trackingId: string }) => p.trackingId === trackingId,
        ),
      ).toBe(true);
    });

    it('GET /api/parcels/:trackingId (public)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/parcels/${trackingId}`)
        .expect(200);

      expect(res.body.trackingId).toBe(trackingId);
    });

    it('PATCH /api/parcels/:trackingId/confirm', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/parcels/${trackingId}/confirm`)
        .set(authHeader(users.receiverToken))
        .expect(200);

      expect(res.body.status).toBe(ParcelStatus.DELIVERED);
    });

    it('GET /api/parcels/delivery-history', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/parcels/delivery-history')
        .set(authHeader(users.receiverToken))
        .expect(200);

      expect(
        res.body.some(
          (p: { trackingId: string }) => p.trackingId === trackingId,
        ),
      ).toBe(true);
    });

    it('POST /api/parcels (second parcel for cancel test)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/parcels')
        .set(authHeader(users.senderToken))
        .send({
          receiverId: users.receiver.id,
          receiverName: users.receiver.name,
          pickupAddress: 'Dhaka',
          deliveryAddress: 'Sylhet',
        })
        .expect(201);

      const cancelTrackingId = res.body.trackingId;

      await request(app.getHttpServer())
        .patch(`/api/parcels/${cancelTrackingId}/cancel`)
        .set(authHeader(users.senderToken))
        .expect(200)
        .expect((cancelRes) => {
          expect(cancelRes.body.status).toBe(ParcelStatus.CANCELLED);
        });
    });

    it('POST /api/parcels (parcel for block test)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/parcels')
        .set(authHeader(users.senderToken))
        .send({
          receiverId: users.receiver.id,
          receiverName: users.receiver.name,
          pickupAddress: 'Dhaka',
          deliveryAddress: 'Rajshahi',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/parcels/${res.body.trackingId}/block`)
        .set(authHeader(users.adminToken))
        .expect(200)
        .expect((blockRes) => {
          expect(blockRes.body.isBlocked).toBe(true);
        });
    });

    it('GET /api/parcels (admin all)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/parcels')
        .set(authHeader(users.adminToken))
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Dashboard', () => {
    it('GET /api/dashboard', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set(authHeader(users.adminToken))
        .expect(200);

      expect(res.body).toMatchObject({
        totalUsers: expect.any(Number),
        activeUsers: expect.any(Number),
        blockedUsers: expect.any(Number),
        totalParcels: expect.any(Number),
        parcelsByStatus: expect.any(Object),
        blockedParcels: expect.any(Number),
      });
    });
  });

  describe('Authorization', () => {
    it('rejects unauthenticated /api/users/me', async () => {
      await request(app.getHttpServer()).get('/api/users/me').expect(401);
    });

    it('rejects non-admin /api/users/all-users', async () => {
      await request(app.getHttpServer())
        .get('/api/users/all-users')
        .set(authHeader(users.senderToken))
        .expect(403);
    });
  });
});
