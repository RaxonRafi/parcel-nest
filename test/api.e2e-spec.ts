import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import request from 'supertest';
import { ParcelStatus } from '../src/parcel/types/parcel.types';
import {
  authHeader,
  createTestApp,
  httpServer,
  seedUsers,
  SeededUsers,
  TEST_PASSWORD,
} from './helpers/test-app';

interface AuthBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: string; isActive: string };
}

interface ParcelBody {
  trackingId: string;
  status: ParcelStatus;
  isBlocked: boolean;
  isCodCollected: boolean;
  deliveryFee: number;
  deliveredAt: string | null;
  deliveryPersonnel: { id: string } | null;
}

interface PageBody<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

interface MessageBody {
  message: string;
}

const PROOF_IMAGE = 'https://cdn.example.com/proof/a.jpg';

describe('API (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let users: SeededUsers;

  beforeAll(async () => {
    app = await createTestApp();
    server = httpServer(app);
    users = await seedUsers(app);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const login = (email: string, password = TEST_PASSWORD) =>
    request(server).post('/api/auth/login').send({ email, password });

  /** Books a parcel from the seeded sender and returns its tracking id. */
  const bookParcel = async (
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await request(server)
      .post('/api/parcels')
      .set(authHeader(users.sender.token))
      .send({
        receiverId: users.receiver.user.id,
        receiverName: users.receiver.user.name,
        pickupAddress: 'Dhaka Pickup',
        deliveryAddress: 'Chittagong Delivery',
        ...overrides,
      })
      .expect(201);

    return (res.body as ParcelBody).trackingId;
  };

  const setStatus = (trackingId: string, status: ParcelStatus, token: string) =>
    request(server)
      .patch(`/api/parcels/${trackingId}/status`)
      .set(authHeader(token))
      .send({ status });

  /** Walks a parcel from PENDING to IN_TRANSIT as an admin. */
  const dispatch = async (trackingId: string): Promise<void> => {
    await setStatus(
      trackingId,
      ParcelStatus.PICKED_UP,
      users.admin.token,
    ).expect(200);
    await setStatus(
      trackingId,
      ParcelStatus.IN_TRANSIT,
      users.admin.token,
    ).expect(200);
  };

  describe('Health', () => {
    it('GET /api', async () => {
      await request(server).get('/api').expect(200);
    });
  });

  describe('Rate limiting', () => {
    it('does not throttle an ordinary route to the credential limit', async () => {
      const trackingId = await bookParcel();

      // The credential limit is 8 a minute; it must not apply here.
      for (let i = 0; i < 12; i++) {
        await request(server).get(`/api/parcels/${trackingId}`).expect(200);
      }
    });
  });

  describe('Auth', () => {
    it('logs in without exposing the password', async () => {
      const res = await login('sender@test.com').expect(201);
      const body = res.body as AuthBody;

      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(body.user.email).toBe('sender@test.com');
      expect(body.user).not.toHaveProperty('password');
    });

    it('rotates a refresh token and refuses to take it twice', async () => {
      const { refreshToken } = (await login('admin@test.com').expect(201))
        .body as AuthBody;

      const rotated = await request(server)
        .post('/api/auth/refresh-token')
        .send({ refreshToken })
        .expect(201);
      expect((rotated.body as AuthBody).refreshToken).not.toBe(refreshToken);

      await request(server)
        .post('/api/auth/refresh-token')
        .send({ refreshToken })
        .expect(401);
    });

    it("does not let one user revoke another's session", async () => {
      const { refreshToken } = (await login('receiver@test.com').expect(201))
        .body as AuthBody;

      await request(server)
        .post('/api/auth/logout')
        .set(authHeader(users.sender.token))
        .send({ refreshToken })
        .expect(201);

      // Still alive: the logout above came from a different account.
      await request(server)
        .post('/api/auth/refresh-token')
        .send({ refreshToken })
        .expect(201);
    });

    it('rejects a token sent without the Bearer scheme', async () => {
      await request(server)
        .get('/api/users/me')
        .set({ Authorization: users.sender.token })
        .expect(401);
    });
  });

  describe('Registration', () => {
    const register = (body: Record<string, unknown>) =>
      request(server)
        .post('/api/users/register')
        .send({ name: 'New User', password: TEST_PASSWORD, ...body });

    it('returns a refresh token that works', async () => {
      const res = await register({ email: 'new-sender@test.com' }).expect(201);
      const body = res.body as AuthBody;

      expect(body.user.role).toBe('SENDER');

      await request(server)
        .post('/api/auth/refresh-token')
        .send({ refreshToken: body.refreshToken })
        .expect(201);
    });

    it('honours RECEIVER on a public signup', async () => {
      const res = await register({
        email: 'new-receiver@test.com',
        role: 'RECEIVER',
      }).expect(201);

      expect((res.body as AuthBody).user.role).toBe('RECEIVER');
    });

    it('parks a courier signup in PENDING_DELIVERY', async () => {
      const res = await register({
        email: 'new-courier@test.com',
        role: 'DELIVERY_PERSONNEL',
      }).expect(201);

      expect((res.body as AuthBody).user.role).toBe('PENDING_DELIVERY');
    });

    it('refuses ADMIN without an admin token', async () => {
      await register({ email: 'new-admin@test.com', role: 'ADMIN' }).expect(
        401,
      );
    });

    it('answers 409 for a duplicate email', async () => {
      await register({ email: 'sender@test.com' }).expect(409);
    });

    it('answers 409, not 500, for a duplicate national id', async () => {
      await register({
        email: 'nid-one@test.com',
        nidNumber: '1990123456789',
      }).expect(201);

      await register({
        email: 'nid-two@test.com',
        nidNumber: '1990123456789',
      }).expect(409);
    });
  });

  describe('Users', () => {
    it('GET /api/users/me', async () => {
      const res = await request(server)
        .get('/api/users/me')
        .set(authHeader(users.receiver.token))
        .expect(200);

      expect((res.body as AuthBody['user']).email).toBe('receiver@test.com');
    });

    it('lists users as a page', async () => {
      const res = await request(server)
        .get('/api/users/all-users?limit=2')
        .set(authHeader(users.admin.token))
        .expect(200);
      const body = res.body as PageBody<unknown>;

      expect(body.data).toHaveLength(2);
      expect(body.meta.total).toBeGreaterThanOrEqual(5);
    });

    it('rejects a non-admin', async () => {
      await request(server)
        .get('/api/users/all-users')
        .set(authHeader(users.sender.token))
        .expect(403);
    });

    it('refuses to let an admin block themselves', async () => {
      await request(server)
        .patch(`/api/users/${users.admin.user.id}/block`)
        .set(authHeader(users.admin.token))
        .expect(403);
    });

    it('locks a blocked user out and lets them back in when unblocked', async () => {
      const id = users.otherSender.user.id;

      await request(server)
        .patch(`/api/users/${id}/block`)
        .set(authHeader(users.admin.token))
        .expect(200);

      await request(server)
        .get('/api/users/me')
        .set(authHeader(users.otherSender.token))
        .expect(401);
      await login('other@test.com').expect(401);

      await request(server)
        .patch(`/api/users/${id}/unblock`)
        .set(authHeader(users.admin.token))
        .expect(200);

      await request(server)
        .get('/api/users/me')
        .set(authHeader(users.otherSender.token))
        .expect(200);
    });
  });

  describe('Parcels', () => {
    it('books a parcel with a server-side fee', async () => {
      const res = await request(server)
        .post('/api/parcels')
        .set(authHeader(users.sender.token))
        .send({
          receiverId: users.receiver.user.id,
          receiverName: users.receiver.user.name,
          pickupAddress: 'Dhaka',
          deliveryAddress: 'Sylhet',
          weightKg: 2.5,
        })
        .expect(201);
      const body = res.body as ParcelBody;

      expect(body.trackingId).toMatch(/^TRK-[0-9A-Z]{12}$/);
      expect(body.status).toBe(ParcelStatus.PENDING);
      // 60 base + 2 extra kilograms (1.5 rounded up) at 25.
      expect(body.deliveryFee).toBe(110);
    });

    it('refuses a parcel addressed to the sender', async () => {
      await request(server)
        .post('/api/parcels')
        .set(authHeader(users.sender.token))
        .send({
          receiverId: users.sender.user.id,
          receiverName: 'Me',
          pickupAddress: 'Dhaka',
          deliveryAddress: 'Dhaka',
        })
        .expect(400);
    });

    it('refuses a jump straight to DELIVERED', async () => {
      const trackingId = await bookParcel();

      await setStatus(
        trackingId,
        ParcelStatus.DELIVERED,
        users.admin.token,
      ).expect(400);
    });

    it('lets an assigned courier move a parcel', async () => {
      const trackingId = await bookParcel();

      const assigned = await request(server)
        .patch(`/api/parcels/${trackingId}/assign`)
        .set(authHeader(users.admin.token))
        .send({ deliveryPersonnelId: users.courier.user.id })
        .expect(200);
      expect((assigned.body as ParcelBody).deliveryPersonnel?.id).toBe(
        users.courier.user.id,
      );

      const res = await setStatus(
        trackingId,
        ParcelStatus.PICKED_UP,
        users.courier.token,
      ).expect(200);
      expect((res.body as ParcelBody).status).toBe(ParcelStatus.PICKED_UP);
    });

    it('stamps deliveredAt when delivery comes through the status route', async () => {
      const trackingId = await bookParcel();
      await dispatch(trackingId);

      const res = await setStatus(
        trackingId,
        ParcelStatus.DELIVERED,
        users.admin.token,
      ).expect(200);

      expect((res.body as ParcelBody).deliveredAt).toEqual(expect.any(String));
    });

    it('stamps deliveredAt when the receiver confirms', async () => {
      const trackingId = await bookParcel();
      await dispatch(trackingId);

      const res = await request(server)
        .patch(`/api/parcels/${trackingId}/confirm`)
        .set(authHeader(users.receiver.token))
        .expect(200);
      const body = res.body as ParcelBody;

      expect(body.status).toBe(ParcelStatus.DELIVERED);
      expect(body.deliveredAt).toEqual(expect.any(String));

      const history = await request(server)
        .get('/api/parcels/delivery-history')
        .set(authHeader(users.receiver.token))
        .expect(200);
      expect(
        (history.body as PageBody<ParcelBody>).data.map((p) => p.trackingId),
      ).toContain(trackingId);
    });

    it('shows a parcel to a receiver whose account is not a RECEIVER', async () => {
      const trackingId = await bookParcel({
        receiverId: users.otherSender.user.id,
        receiverName: users.otherSender.user.name,
      });

      const incoming = await request(server)
        .get('/api/parcels/incoming-parcels')
        .set(authHeader(users.otherSender.token))
        .expect(200);
      expect(
        (incoming.body as PageBody<ParcelBody>).data.map((p) => p.trackingId),
      ).toContain(trackingId);

      await dispatch(trackingId);
      await request(server)
        .patch(`/api/parcels/${trackingId}/confirm`)
        .set(authHeader(users.otherSender.token))
        .expect(200);
    });

    it("does not let someone confirm a parcel that isn't theirs", async () => {
      const trackingId = await bookParcel();
      await dispatch(trackingId);

      await request(server)
        .patch(`/api/parcels/${trackingId}/confirm`)
        .set(authHeader(users.otherSender.token))
        .expect(403);
    });

    describe('cash on delivery', () => {
      let trackingId: string;

      beforeAll(async () => {
        trackingId = await bookParcel({ codAmount: 500 });
        await request(server)
          .patch(`/api/parcels/${trackingId}/assign`)
          .set(authHeader(users.admin.token))
          .send({ deliveryPersonnelId: users.courier.user.id })
          .expect(200);
        await dispatch(trackingId);
      });

      it('cannot be marked delivered through the status route', async () => {
        await setStatus(
          trackingId,
          ParcelStatus.DELIVERED,
          users.courier.token,
        ).expect(400);
      });

      it('cannot be confirmed by the receiver before the cash is recorded', async () => {
        await request(server)
          .patch(`/api/parcels/${trackingId}/confirm`)
          .set(authHeader(users.receiver.token))
          .expect(400);
      });

      it('is refused proof that does not record the cash', async () => {
        await request(server)
          .patch(`/api/parcels/${trackingId}/delivery-proof`)
          .set(authHeader(users.courier.token))
          .send({ images: [PROOF_IMAGE] })
          .expect(400);
      });

      it('is delivered by proof that records the cash', async () => {
        const res = await request(server)
          .patch(`/api/parcels/${trackingId}/delivery-proof`)
          .set(authHeader(users.courier.token))
          .send({ images: [PROOF_IMAGE], codCollected: true })
          .expect(200);
        const body = res.body as ParcelBody;

        expect(body.status).toBe(ParcelStatus.DELIVERED);
        expect(body.isCodCollected).toBe(true);
        expect(body.deliveredAt).toEqual(expect.any(String));
      });
    });

    describe('cancelling', () => {
      it('is allowed for the sender while PENDING', async () => {
        const trackingId = await bookParcel();

        const res = await request(server)
          .patch(`/api/parcels/${trackingId}/cancel`)
          .set(authHeader(users.sender.token))
          .expect(200);

        expect((res.body as ParcelBody).status).toBe(ParcelStatus.CANCELLED);
      });

      it('is refused for the sender after pickup, but open to an admin', async () => {
        const trackingId = await bookParcel();
        await setStatus(
          trackingId,
          ParcelStatus.PICKED_UP,
          users.admin.token,
        ).expect(200);

        await request(server)
          .patch(`/api/parcels/${trackingId}/cancel`)
          .set(authHeader(users.sender.token))
          .expect(400);

        await setStatus(
          trackingId,
          ParcelStatus.CANCELLED,
          users.admin.token,
        ).expect(200);
      });
    });

    describe('blocking', () => {
      let trackingId: string;

      beforeAll(async () => {
        trackingId = await bookParcel();
      });

      it('puts a parcel on hold', async () => {
        const res = await request(server)
          .patch(`/api/parcels/${trackingId}/block`)
          .set(authHeader(users.admin.token))
          .expect(200);

        expect((res.body as ParcelBody).isBlocked).toBe(true);
      });

      it('freezes it for everyone', async () => {
        await request(server)
          .patch(`/api/parcels/${trackingId}/cancel`)
          .set(authHeader(users.sender.token))
          .expect(400);
        await setStatus(
          trackingId,
          ParcelStatus.PICKED_UP,
          users.admin.token,
        ).expect(400);
      });

      it('can be released, after which the parcel moves again', async () => {
        const res = await request(server)
          .patch(`/api/parcels/${trackingId}/unblock`)
          .set(authHeader(users.admin.token))
          .expect(200);
        expect((res.body as ParcelBody).isBlocked).toBe(false);

        await setStatus(
          trackingId,
          ParcelStatus.PICKED_UP,
          users.admin.token,
        ).expect(200);
      });

      it('refuses to release a parcel that is not blocked', async () => {
        await request(server)
          .patch(`/api/parcels/${trackingId}/unblock`)
          .set(authHeader(users.admin.token))
          .expect(400);
      });

      it('leaves both actions in the audit trail', async () => {
        const res = await request(server)
          .get(`/api/audit-logs/target/${trackingId}`)
          .set(authHeader(users.admin.token))
          .expect(200);
        const actions = (res.body as PageBody<{ action: string }>).data.map(
          (entry) => entry.action,
        );

        expect(actions).toEqual(
          expect.arrayContaining(['PARCEL_BLOCKED', 'PARCEL_UNBLOCKED']),
        );
      });
    });

    it('tracks publicly without exposing user records', async () => {
      const trackingId = await bookParcel();

      const res = await request(server)
        .get(`/api/parcels/${trackingId}`)
        .expect(200);

      expect((res.body as ParcelBody).trackingId).toBe(trackingId);
      expect(res.body).not.toHaveProperty('sender');
      expect(res.body).not.toHaveProperty('receiver');
    });

    it('lists the sender their own parcels as a page', async () => {
      const res = await request(server)
        .get('/api/parcels/my-parcels?limit=5')
        .set(authHeader(users.sender.token))
        .expect(200);
      const body = res.body as PageBody<ParcelBody>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.length).toBeLessThanOrEqual(5);
      expect(body.meta.total).toBeGreaterThan(5);
    });
  });

  describe('Dashboard', () => {
    it('GET /api/dashboard', async () => {
      const res = await request(server)
        .get('/api/dashboard')
        .set(authHeader(users.admin.token))
        .expect(200);

      expect(res.body).toMatchObject({
        totalUsers: expect.any(Number) as number,
        activeUsers: expect.any(Number) as number,
        blockedUsers: expect.any(Number) as number,
        totalParcels: expect.any(Number) as number,
        blockedParcels: expect.any(Number) as number,
      });
    });
  });

  describe('System', () => {
    it('accepts a contact-form message', async () => {
      const res = await request(server)
        .post('/api/contact')
        .send({
          name: 'Zain Malik',
          email: 'zain@example.com',
          topic: 'tracking',
          message: 'My parcel has not moved since yesterday.',
        })
        .expect(201);

      expect((res.body as MessageBody).message).toMatch(/sent/);
    });

    it('keeps the cron endpoint closed to anyone without the secret', async () => {
      await request(server).get('/api/keep-alive').expect(401);
      await request(server)
        .get('/api/keep-alive')
        .set(authHeader(users.admin.token))
        .expect(401);
    });
  });

  describe('Assistant', () => {
    it('requires a signed-in user on ask', async () => {
      await request(server)
        .post('/api/rag/ask')
        .send({ question: 'Where is my parcel?' })
        .expect(401);
    });

    it('requires a signed-in user on ask/stream', async () => {
      await request(server)
        .post('/api/rag/ask/stream')
        .send({ question: 'Where is my parcel?' })
        .expect(401);
    });

    it('answers 503 when no provider keys are configured', async () => {
      const res = await request(server)
        .post('/api/rag/ask')
        .set(authHeader(users.sender.token))
        .send({ question: 'Where is my parcel?' })
        .expect(503);

      expect((res.body as MessageBody).message).toMatch(/not configured/);
    });
  });
});
