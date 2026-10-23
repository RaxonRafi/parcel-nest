import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import request from 'supertest';
import { ParcelNotificationService } from '../src/parcel/services/parcel-notification.service';
import { SslCommerzGateway } from '../src/payment/gateways/sslcommerz.gateway';
import {
  authHeader,
  createTestApp,
  httpServer,
  seedUsers,
  SeededUsers,
} from './helpers/test-app';

interface ParcelBody {
  trackingId: string;
  status: string;
  deliveryFee: number;
  codAmount: number;
  paymentStatus: string;
  returnFee: number | null;
  serviceTier: string;
  pickupZone: string;
  deliveryZone: string;
  estimatedDeliveryAt: string | null;
  deliveryAttempts: number;
  lastFailureReason: string | null;
  rescheduledFor: string | null;
  feeBreakdown: Record<string, unknown>;
  receiverPhone?: string;
  deliveryAddress: string;
  weightKg: number;
}

interface StatementBody {
  accountType: string;
  balance: number;
  entries: { data: { type: string; amount: number; trackingId: string | null }[] };
}

const HOUR = 3_600_000;

/**
 * The delivery flow end to end, money included: the "customer buys a
 * 2,000 taka product, the shop ships it through us" story, its unhappy
 * endings, and everything a merchant does around it.
 */
describe('Core delivery flow (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let users: SeededUsers;
  /** Codes "emailed" to receivers, newest last, by tracking id. */
  const codes = new Map<string, string[]>();

  beforeAll(async () => {
    app = await createTestApp();
    server = httpServer(app);
    users = await seedUsers(app);

    jest
      .spyOn(app.get(ParcelNotificationService), 'sendDeliveryCode')
      .mockImplementation((parcel, code) => {
        codes.set(parcel.trackingId, [
          ...(codes.get(parcel.trackingId) ?? []),
          code,
        ]);
      });
  });

  afterAll(async () => {
    await app?.close();
  });

  const book = async (
    overrides: Record<string, unknown> = {},
  ): Promise<ParcelBody> => {
    const res = await request(server)
      .post('/api/parcels')
      .set(authHeader(users.sender.token))
      .send({
        receiverId: users.receiver.user.id,
        receiverName: 'Rahim Uddin',
        receiverPhone: '+8801800000000',
        pickupAddress: 'Warehouse 3, Tejgaon, Dhaka',
        deliveryAddress: 'House 7, Road 2, Dhanmondi, Dhaka',
        ...overrides,
      })
      .expect(201);
    return res.body as ParcelBody;
  };

  const move = (
    trackingId: string,
    status: string,
    token = users.courier.token,
    expected = 200,
  ) =>
    request(server)
      .patch(`/api/parcels/${trackingId}/status`)
      .set(authHeader(token))
      .send({ status })
      .expect(expected);

  /** Booked, assigned, collected and on the road — one step from the door. */
  const outForDelivery = async (
    overrides: Record<string, unknown> = {},
  ): Promise<ParcelBody> => {
    const parcel = await book(overrides);
    await request(server)
      .patch(`/api/parcels/${parcel.trackingId}/assign`)
      .set(authHeader(users.admin.token))
      .send({ deliveryPersonnelId: users.courier.user.id })
      .expect(200);
    await move(parcel.trackingId, 'PICKED_UP');
    await move(parcel.trackingId, 'IN_TRANSIT');
    await move(parcel.trackingId, 'OUT_FOR_DELIVERY');
    return parcel;
  };

  const latestCode = (trackingId: string): string => {
    const issued = codes.get(trackingId);
    if (!issued?.length) throw new Error(`No code issued for ${trackingId}`);
    return issued[issued.length - 1];
  };

  const statement = async (token: string): Promise<StatementBody> =>
    (
      await request(server)
        .get('/api/ledger/me')
        .set(authHeader(token))
        .expect(200)
    ).body as StatementBody;

  describe('a 2,000 taka cash-on-delivery order', () => {
    let parcel: ParcelBody;
    let senderBefore: number;
    let courierBefore: number;

    beforeAll(async () => {
      senderBefore = (await statement(users.sender.token)).balance;
      courierBefore = (await statement(users.courier.token)).balance;
      parcel = await outForDelivery({ weightKg: 1.5, codAmount: 2000 });
    });

    it('is priced 60 base + 25 weight + 20 cash handling, taken from the cash', () => {
      expect(parcel.deliveryFee).toBe(105);
      expect(parcel.feeBreakdown).toMatchObject({
        route: 'CITY',
        baseFee: 60,
        weightFee: 25,
        codFee: 20,
        expressFee: 0,
      });
      expect(parcel.paymentStatus).toBe('NOT_REQUIRED');
      expect(parcel.estimatedDeliveryAt).not.toBeNull();
    });

    it('charged the shop the fee at booking', async () => {
      const mine = await statement(users.sender.token);
      expect(mine.balance).toBe(senderBefore - 105);
      expect(mine.entries.data[0]).toMatchObject({
        type: 'DELIVERY_FEE',
        amount: -105,
        trackingId: parcel.trackingId,
      });
    });

    it('emailed the receiver a delivery code when it went out', () => {
      expect(latestCode(parcel.trackingId)).toMatch(/^\d{6}$/);
    });

    it('refuses a wrong code and says how many tries are left', async () => {
      const wrong = latestCode(parcel.trackingId) === '000000' ? '111111' : '000000';
      const res = await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/delivery-proof`)
        .set(authHeader(users.courier.token))
        .send({
          images: ['https://cdn.example.com/p.jpg'],
          codCollected: true,
          deliveryCode: wrong,
        })
        .expect(400);
      expect((res.body as { message: string }).message).toMatch(/4 attempts left/);
    });

    it('is delivered with the right code and the cash collected', async () => {
      const res = await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/delivery-proof`)
        .set(authHeader(users.courier.token))
        .send({
          images: ['https://cdn.example.com/p.jpg'],
          codCollected: true,
          deliveryCode: latestCode(parcel.trackingId),
        })
        .expect(200);
      expect((res.body as ParcelBody).status).toBe('DELIVERED');
    });

    it('puts 2,000 in the courier’s hands and 1,895 net on the shop’s balance', async () => {
      expect((await statement(users.courier.token)).balance).toBe(
        courierBefore + 2000,
      );
      expect((await statement(users.sender.token)).balance).toBe(
        senderBefore - 105 + 2000,
      );
    });

    it('does not move the money twice when proof is added again', async () => {
      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/delivery-proof`)
        .set(authHeader(users.courier.token))
        .send({ images: ['https://cdn.example.com/p2.jpg'], codCollected: true })
        .expect(200);
      expect((await statement(users.courier.token)).balance).toBe(
        courierBefore + 2000,
      );
    });

    it('settles: the courier hands the cash in, the shop is paid out', async () => {
      const courierId = users.courier.user.id;
      const senderId = users.sender.user.id;
      const courierHolds = (await statement(users.courier.token)).balance;
      const shopIsOwed = (await statement(users.sender.token)).balance;

      // Not a penny more than they hold, or are owed.
      await request(server)
        .post(`/api/ledger/couriers/${courierId}/deposits`)
        .set(authHeader(users.admin.token))
        .send({ amount: courierHolds + 1 })
        .expect(400);
      await request(server)
        .post(`/api/ledger/couriers/${courierId}/deposits`)
        .set(authHeader(users.admin.token))
        .send({ amount: courierHolds, reference: 'HUB-1' })
        .expect(201);
      expect((await statement(users.courier.token)).balance).toBe(0);

      await request(server)
        .post(`/api/ledger/merchants/${senderId}/payouts`)
        .set(authHeader(users.admin.token))
        .send({ amount: shopIsOwed + 1, method: 'BKASH' })
        .expect(400);
      const paid = await request(server)
        .post(`/api/ledger/merchants/${senderId}/payouts`)
        .set(authHeader(users.admin.token))
        .send({ amount: shopIsOwed, method: 'BKASH', reference: '9F3K2LQ1' })
        .expect(201);
      expect((paid.body as StatementBody).balance).toBe(0);
    });

    it('keeps settlement to admins', async () => {
      await request(server)
        .post(`/api/ledger/merchants/${users.sender.user.id}/payouts`)
        .set(authHeader(users.sender.token))
        .send({ amount: 1, method: 'CASH' })
        .expect(403);
      await request(server)
        .get('/api/ledger/couriers')
        .set(authHeader(users.courier.token))
        .expect(403);
    });

    it('lists balances for an admin', async () => {
      const res = await request(server)
        .get('/api/ledger/merchants')
        .set(authHeader(users.admin.token))
        .expect(200);
      const rows = (res.body as { data: { userId: string; balance: number }[] })
        .data;
      expect(rows.find((row) => row.userId === users.sender.user.id)).toMatchObject(
        { balance: 0 },
      );
    });
  });

  describe('when nobody is home', () => {
    let parcel: ParcelBody;
    let senderBefore: number;

    beforeAll(async () => {
      senderBefore = (await statement(users.sender.token)).balance;
      parcel = await outForDelivery({ weightKg: 1.5, codAmount: 2000 });
    });

    it('is not a status the status route sets', async () => {
      await move(parcel.trackingId, 'FAILED_ATTEMPT', users.courier.token, 400);
    });

    it('records the attempt with its reason and a new day', async () => {
      const tomorrow = new Date(Date.now() + 24 * HOUR).toISOString();
      const res = await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/failed-attempt`)
        .set(authHeader(users.courier.token))
        .send({
          reason: 'RECEIVER_UNAVAILABLE',
          note: 'Phone off, guard says abroad',
          rescheduledFor: tomorrow,
        })
        .expect(200);
      const body = res.body as ParcelBody;
      expect(body).toMatchObject({
        status: 'FAILED_ATTEMPT',
        deliveryAttempts: 1,
        lastFailureReason: 'RECEIVER_UNAVAILABLE',
        rescheduledFor: tomorrow,
        estimatedDeliveryAt: tomorrow,
      });
    });

    it('keeps the courier’s own words off the public tracking page', async () => {
      const res = await request(server)
        .get(`/api/parcels/${parcel.trackingId}`)
        .expect(200);
      const notes = (res.body as { statusLogs: { note: string | null }[] })
        .statusLogs.map((log) => log.note)
        .join(' | ');
      expect(notes).toContain('Delivery attempt 1 failed');
      expect(notes).not.toContain('abroad');
    });

    it('lets the receiver pick another day, but not a stranger', async () => {
      const later = new Date(Date.now() + 48 * HOUR).toISOString();
      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/reschedule`)
        .set(authHeader(users.otherSender.token))
        .send({ rescheduledFor: later })
        .expect(403);
      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/reschedule`)
        .set(authHeader(users.receiver.token))
        .send({ rescheduledFor: later })
        .expect(200);
      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/reschedule`)
        .set(authHeader(users.receiver.token))
        .send({ rescheduledFor: new Date(Date.now() - 24 * HOUR).toISOString() })
        .expect(400);
    });

    it('goes out again with a fresh code, and the old one stops working', async () => {
      const first = latestCode(parcel.trackingId);
      await move(parcel.trackingId, 'OUT_FOR_DELIVERY');
      const second = latestCode(parcel.trackingId);
      expect(codes.get(parcel.trackingId)).toHaveLength(2);

      if (first !== second) {
        await request(server)
          .patch(`/api/parcels/${parcel.trackingId}/delivery-proof`)
          .set(authHeader(users.courier.token))
          .send({
            images: ['https://cdn.example.com/p.jpg'],
            codCollected: true,
            deliveryCode: first,
          })
          .expect(400);
      }
    });

    it('stops going out after the third failure', async () => {
      for (const attempt of [2, 3]) {
        await request(server)
          .patch(`/api/parcels/${parcel.trackingId}/failed-attempt`)
          .set(authHeader(users.courier.token))
          .send({ reason: 'REFUSED' })
          .expect(200);
        if (attempt < 3) await move(parcel.trackingId, 'OUT_FOR_DELIVERY');
      }
      const res = await move(
        parcel.trackingId,
        'OUT_FOR_DELIVERY',
        users.courier.token,
        400,
      );
      expect((res.body as { message: string }).message).toMatch(/return/i);
    });

    it('goes back to the shop, which pays for the trip but not for cash handling', async () => {
      await move(parcel.trackingId, 'RETURNING');
      const res = await move(parcel.trackingId, 'RETURNED_TO_SENDER');
      const body = res.body as ParcelBody;

      // 50% of the delivery charge (60 + 25), none of it the cash fee.
      expect(body.returnFee).toBe(42.5);
      expect(body.status).toBe('RETURNED_TO_SENDER');

      const mine = await statement(users.sender.token);
      // −105 at booking, +20 cash fee back, −42.50 for the return.
      expect(mine.balance).toBe(senderBefore - 105 + 20 - 42.5);
      expect(mine.entries.data.map((entry) => entry.type)).toEqual(
        expect.arrayContaining(['RETURN_FEE', 'COD_FEE_REVERSAL']),
      );
    });

    it('is final once returned', async () => {
      await move(parcel.trackingId, 'OUT_FOR_DELIVERY', users.courier.token, 400);
    });
  });

  describe('before pickup', () => {
    it('lets the sender fix the booking, re-pricing it on the ledger', async () => {
      const before = (await statement(users.sender.token)).balance;
      const parcel = await book({ weightKg: 1 });
      expect(parcel.deliveryFee).toBe(60);

      const res = await request(server)
        .patch(`/api/parcels/${parcel.trackingId}`)
        .set(authHeader(users.sender.token))
        .send({
          weightKg: 3,
          receiverPhone: '+8801711111111',
          deliveryAddress: 'Flat 4B, 9 Lake Road, Banani, Dhaka',
        })
        .expect(200);
      const updated = res.body as ParcelBody;
      expect(updated).toMatchObject({
        deliveryFee: 110,
        receiverPhone: '+8801711111111',
        deliveryAddress: 'Flat 4B, 9 Lake Road, Banani, Dhaka',
      });
      expect((await statement(users.sender.token)).balance).toBe(before - 110);
    });

    it('refuses an edit from anyone but the sender, and after pickup', async () => {
      const parcel = await book();
      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}`)
        .set(authHeader(users.otherSender.token))
        .send({ description: 'mine now' })
        .expect(403);
      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}`)
        .set(authHeader(users.sender.token))
        .send({ receiverId: users.otherSender.user.id })
        .expect(400);

      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/assign`)
        .set(authHeader(users.admin.token))
        .send({ deliveryPersonnelId: users.courier.user.id })
        .expect(200);
      await move(parcel.trackingId, 'PICKED_UP');
      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}`)
        .set(authHeader(users.sender.token))
        .send({ description: 'too late' })
        .expect(400);
    });

    it('gives the whole fee back when the sender cancels', async () => {
      const before = (await statement(users.sender.token)).balance;
      const parcel = await book({ weightKg: 2, codAmount: 1000 });
      await request(server)
        .patch(`/api/parcels/${parcel.trackingId}/cancel`)
        .set(authHeader(users.sender.token))
        .expect(200);
      expect((await statement(users.sender.token)).balance).toBe(before);
    });
  });

  describe('zones, tiers and schedule', () => {
    it('prices a suburb and a nationwide trip on their own base fee', async () => {
      const suburb = await request(server)
        .post('/api/parcels/quote')
        .send({ pickupZone: 'DHAKA_CITY', deliveryZone: 'DHAKA_SUBURB' })
        .expect(201);
      expect(suburb.body).toMatchObject({ route: 'SUBURB', total: 80 });

      const national = await request(server)
        .post('/api/parcels/quote')
        .send({ deliveryZone: 'OUTSIDE_DHAKA' })
        .expect(201);
      expect(national.body).toMatchObject({ route: 'NATIONAL', total: 120 });
    });

    it('charges for express, and only offers it inside Dhaka', async () => {
      const express = await request(server)
        .post('/api/parcels/quote')
        .send({ serviceTier: 'EXPRESS' })
        .expect(201);
      expect(express.body).toMatchObject({ expressFee: 50, total: 110 });

      await request(server)
        .post('/api/parcels/quote')
        .send({ serviceTier: 'EXPRESS', deliveryZone: 'OUTSIDE_DHAKA' })
        .expect(400);
    });

    it('books a pickup slot and promises delivery a day after it', async () => {
      const start = new Date(Date.now() + 2 * HOUR);
      const end = new Date(Date.now() + 5 * HOUR);
      const parcel = await book({
        pickupWindowStart: start.toISOString(),
        pickupWindowEnd: end.toISOString(),
      });
      expect(new Date(parcel.estimatedDeliveryAt!).getTime()).toBe(
        end.getTime() + 24 * HOUR,
      );
    });

    it('refuses a slot that is half given, backwards, too long or in the past', async () => {
      const at = (hours: number) =>
        new Date(Date.now() + hours * HOUR).toISOString();
      for (const window of [
        { pickupWindowStart: at(2) },
        { pickupWindowStart: at(5), pickupWindowEnd: at(2) },
        { pickupWindowStart: at(2), pickupWindowEnd: at(20) },
        { pickupWindowStart: at(-5), pickupWindowEnd: at(-2) },
      ]) {
        await request(server)
          .post('/api/parcels')
          .set(authHeader(users.sender.token))
          .send({
            receiverId: users.receiver.user.id,
            receiverName: 'Rahim Uddin',
            pickupAddress: 'Tejgaon, Dhaka',
            deliveryAddress: 'Dhanmondi, Dhaka',
            ...window,
          })
          .expect(400);
      }
    });
  });

  describe('labels and invoices', () => {
    it('prints a label PDF for the sender and the courier', async () => {
      const parcel = await outForDelivery({ codAmount: 2000 });
      for (const token of [users.sender.token, users.courier.token]) {
        const res = await request(server)
          .get(`/api/parcels/${parcel.trackingId}/label`)
          .set(authHeader(token))
          .buffer(true)
          .parse((response, done) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => done(null, Buffer.concat(chunks)));
          })
          .expect(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      }
    });

    it('keeps the invoice to the sender and admins', async () => {
      const parcel = await book();
      await request(server)
        .get(`/api/parcels/${parcel.trackingId}/invoice`)
        .set(authHeader(users.sender.token))
        .expect(200)
        .expect('Content-Type', /application\/pdf/);
      await request(server)
        .get(`/api/parcels/${parcel.trackingId}/invoice`)
        .set(authHeader(users.receiver.token))
        .expect(403);
    });
  });

  describe('bulk booking from a CSV', () => {
    const csv = (body: string) => Buffer.from(body, 'utf8');
    const upload = (file: Buffer, fields: Record<string, string> = {}) => {
      const req = request(server)
        .post('/api/parcels/bulk')
        .set(authHeader(users.sender.token))
        .attach('file', file, { filename: 'orders.csv', contentType: 'text/csv' });
      for (const [key, value] of Object.entries(fields)) req.field(key, value);
      return req;
    };

    it('books every row, with the warehouse address given once', async () => {
      const res = await upload(
        csv(
          [
            'receiverName,receiverEmail,receiverPhone,deliveryAddress,weightKg,codAmount,deliveryZone',
            'Karim Ahmed,karim@test.com,+8801711000001,"House 1, Mirpur 10, Dhaka",1,1500,DHAKA_CITY',
            '"Nusrat ""Nisa"" Jahan",nisa@test.com,,"12 Station Road, Rajshahi",2.5,,OUTSIDE_DHAKA',
          ].join('\r\n'),
        ),
        { pickupAddress: 'Warehouse 3, Tejgaon, Dhaka' },
      ).expect(201);

      const body = res.body as {
        created: number;
        failed: number;
        results: { line: number; trackingId?: string }[];
      };
      expect(body).toMatchObject({ created: 2, failed: 0 });
      expect(body.results.map((row) => row.line)).toEqual([2, 3]);
    });

    it('books nothing when a row is invalid, and says which', async () => {
      const res = await upload(
        csv(
          [
            'receiverName,receiverEmail,pickupAddress,deliveryAddress,weightKg',
            'Ok Person,ok@test.com,Tejgaon,Dhanmondi,1',
            'Bad Person,not-an-email,Tejgaon,Dhanmondi,-3',
          ].join('\n'),
        ),
      ).expect(400);
      const body = res.body as { errors: { line: number; errors: string[] }[] };
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].line).toBe(3);
    });

    it('refuses an unknown column', async () => {
      await upload(csv('receiverName,colour\nA,red\n')).expect(400);
    });
  });

  describe('online payment, when not configured', () => {
    it('answers 503', async () => {
      const parcel = await book();
      await request(server)
        .post(`/api/payments/parcels/${parcel.trackingId}/checkout`)
        .set(authHeader(users.sender.token))
        .expect(503);
    });
  });
});

/**
 * A second app, with SSLCommerz replaced by a stand-in that answers the way
 * the real one does — including the validation call a payment is believed on.
 */
describe('Online payment (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let users: SeededUsers;
  const validations = new Map<string, Record<string, string>>();

  const gateway = {
    isEnabled: () => true,
    createSession: jest.fn(({ tranId }: { tranId: string }) =>
      Promise.resolve(`https://sandbox.sslcommerz.com/EasyCheckOut/${tranId}`),
    ),
    validate: jest.fn((valId: string) =>
      Promise.resolve(validations.get(valId) ?? { status: 'INVALID_TRANSACTION' }),
    ),
  };

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(SslCommerzGateway).useValue(gateway),
    );
    server = httpServer(app);
    users = await seedUsers(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const book = async (codAmount = 0): Promise<ParcelBody> =>
    (
      await request(server)
        .post('/api/parcels')
        .set(authHeader(users.sender.token))
        .send({
          receiverId: users.receiver.user.id,
          receiverName: 'Rahim Uddin',
          pickupAddress: 'Tejgaon, Dhaka',
          deliveryAddress: 'Dhanmondi, Dhaka',
          codAmount,
        })
        .expect(201)
    ).body as ParcelBody;

  const checkout = async (trackingId: string) =>
    (
      await request(server)
        .post(`/api/payments/parcels/${trackingId}/checkout`)
        .set(authHeader(users.sender.token))
        .expect(201)
    ).body as { tranId: string; amount: number; gatewayUrl: string };

  const balance = async (): Promise<number> =>
    (
      (
        await request(server)
          .get('/api/ledger/me')
          .set(authHeader(users.sender.token))
          .expect(200)
      ).body as StatementBody
    ).balance;

  it('opens a session for the fee and sends the browser to the gateway', async () => {
    const parcel = await book();
    const session = await checkout(parcel.trackingId);
    expect(session.amount).toBe(60);
    expect(session.gatewayUrl).toContain(session.tranId);
    expect(gateway.createSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        amount: 60,
        successUrl: expect.stringMatching(/\/api\/payments\/sslcommerz\/success$/) as string,
      }),
    );
  });

  it('credits the fee once a validated payment comes back, however often it is reported', async () => {
    const parcel = await book();
    const before = await balance();
    const { tranId } = await checkout(parcel.trackingId);
    validations.set('VAL-1', {
      status: 'VALID',
      tran_id: tranId,
      val_id: 'VAL-1',
      amount: '60.00',
      currency: 'BDT',
      card_type: 'BKASH-BKash',
      risk_level: '0',
    });

    const redirect = await request(server)
      .post('/api/payments/sslcommerz/success')
      .type('form')
      .send({ tran_id: tranId, val_id: 'VAL-1', status: 'VALID' })
      .expect(303);
    expect(redirect.headers.location).toContain('status=paid');
    expect(redirect.headers.location).toContain(parcel.trackingId);

    // The IPN for the same payment, arriving after the browser.
    await request(server)
      .post('/api/payments/sslcommerz/ipn')
      .type('form')
      .send({ tran_id: tranId, val_id: 'VAL-1', status: 'VALID' })
      .expect(200);

    expect(await balance()).toBe(before + 60);
    const details = await request(server)
      .get(`/api/parcels/${parcel.trackingId}/details`)
      .set(authHeader(users.sender.token))
      .expect(200);
    expect((details.body as ParcelBody).paymentStatus).toBe('PAID');

    // Paid is paid: no second checkout, no price change.
    await request(server)
      .post(`/api/payments/parcels/${parcel.trackingId}/checkout`)
      .set(authHeader(users.sender.token))
      .expect(400);
    await request(server)
      .patch(`/api/parcels/${parcel.trackingId}`)
      .set(authHeader(users.sender.token))
      .send({ weightKg: 5 })
      .expect(400);
  });

  it('believes the gateway, not the browser: a forged or short payment credits nothing', async () => {
    const parcel = await book();
    const before = await balance();
    const { tranId } = await checkout(parcel.trackingId);

    // No validation on file for this id: the gateway says it is invalid.
    const forged = await request(server)
      .post('/api/payments/sslcommerz/success')
      .type('form')
      .send({ tran_id: tranId, val_id: 'MADE-UP', status: 'VALID' })
      .expect(303);
    expect(forged.headers.location).toContain('status=failed');

    validations.set('VAL-SHORT', {
      status: 'VALID',
      tran_id: tranId,
      amount: '1.00',
      currency: 'BDT',
    });
    await request(server)
      .post('/api/payments/sslcommerz/ipn')
      .type('form')
      .send({ tran_id: tranId, val_id: 'VAL-SHORT' })
      .expect(200);

    expect(await balance()).toBe(before);
    const payments = await request(server)
      .get(`/api/payments/parcels/${parcel.trackingId}`)
      .set(authHeader(users.sender.token))
      .expect(200);
    expect((payments.body as { status: string }[])[0].status).toBe('FAILED');
  });

  it('records a cancelled checkout and sends the browser back', async () => {
    const parcel = await book();
    const { tranId } = await checkout(parcel.trackingId);
    const res = await request(server)
      .post('/api/payments/sslcommerz/cancel')
      .type('form')
      .send({ tran_id: tranId })
      .expect(303);
    expect(res.headers.location).toContain('status=cancelled');
  });

  it('has nothing to pay on a cash-on-delivery parcel', async () => {
    const parcel = await book(2000);
    await request(server)
      .post(`/api/payments/parcels/${parcel.trackingId}/checkout`)
      .set(authHeader(users.sender.token))
      .expect(400);
  });

  it('only lets the sender pay', async () => {
    const parcel = await book();
    await request(server)
      .post(`/api/payments/parcels/${parcel.trackingId}/checkout`)
      .set(authHeader(users.otherSender.token))
      .expect(403);
  });
});
