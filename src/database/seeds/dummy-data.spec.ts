import { buildParcels, buildStatusLogs, buildUsers, fee } from './dummy-data';
import { calculateDeliveryFee } from '../../parcel/utils/pricing.util';

describe('dummy-data seed', () => {
  const users = buildUsers('hashed-password');
  const senders = users.filter((u) => u.role === 'SENDER');
  const receivers = users.filter((u) => u.role === 'RECEIVER');
  const couriers = users.filter((u) => u.role === 'DELIVERY_PERSONNEL');
  const parcels = buildParcels(senders, receivers, couriers);
  const logs = buildStatusLogs(parcels);

  describe('users', () => {
    it('produces 40 accounts covering every role', () => {
      expect(users).toHaveLength(40);
      const roles = new Set(users.map((u) => u.role));
      expect(roles).toEqual(
        new Set([
          'ADMIN',
          'SENDER',
          'RECEIVER',
          'DELIVERY_PERSONNEL',
          'PENDING_DELIVERY',
        ]),
      );
    });

    it('tags every account so down() can find them', () => {
      expect(users.every((u) => u.email.endsWith('@seed.local'))).toBe(true);
    });

    it('gives every account a unique id and email', () => {
      expect(new Set(users.map((u) => u.id)).size).toBe(users.length);
      expect(new Set(users.map((u) => u.email)).size).toBe(users.length);
    });

    it('includes blocked accounts so admin filters have something to match', () => {
      expect(users.some((u) => u.isActive === 'BLOCKED')).toBe(true);
      expect(users.some((u) => u.isActive === 'ACTIVE')).toBe(true);
    });

    it('includes pending courier applications', () => {
      expect(users.filter((u) => u.role === 'PENDING_DELIVERY').length).toBe(3);
    });
  });

  describe('parcels', () => {
    it('produces 200 parcels with unique tracking ids', () => {
      expect(parcels).toHaveLength(200);
      expect(new Set(parcels.map((p) => p.trackingId)).size).toBe(200);
      expect(parcels.every((p) => p.trackingId.startsWith('TRK-SEED-'))).toBe(
        true,
      );
    });

    it('references only real senders and receivers', () => {
      const senderIds = new Set(senders.map((u) => u.id));
      const receiverIds = new Set(receivers.map((u) => u.id));

      expect(parcels.every((p) => senderIds.has(p.senderId))).toBe(true);
      expect(parcels.every((p) => receiverIds.has(p.receiverId))).toBe(true);
    });

    it('assigns a courier exactly when the status implies one', () => {
      const courierIds = new Set(couriers.map((u) => u.id));

      for (const parcel of parcels) {
        const needsCourier =
          parcel.status !== 'PENDING' && parcel.status !== 'CANCELLED';

        if (needsCourier) {
          expect(courierIds.has(parcel.courierId)).toBe(true);
        } else {
          expect(parcel.courierId).toBe('');
        }
      }
    });

    it('stamps deliveredAt on delivered parcels and nothing else', () => {
      for (const parcel of parcels) {
        if (parcel.status === 'DELIVERED') {
          expect(parcel.deliveredAt).not.toBe('');
          expect(new Date(parcel.deliveredAt).getTime()).toBeGreaterThan(
            new Date(parcel.createdAt).getTime(),
          );
        } else {
          expect(parcel.deliveredAt).toBe('');
        }
      }
    });

    it('only marks COD collected on delivered parcels that had COD', () => {
      for (const parcel of parcels) {
        if (parcel.isCodCollected) {
          expect(parcel.status).toBe('DELIVERED');
          expect(parcel.codAmount).toBeGreaterThan(0);
        }
      }
    });

    it('spreads creation dates across the trend window', () => {
      const days = parcels.map((p) =>
        Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86_400_000),
      );

      expect(Math.min(...days)).toBeLessThanOrEqual(2);
      expect(Math.max(...days)).toBeGreaterThan(60);
      // Enough distinct days that the daily series is a curve, not a spike.
      expect(new Set(days).size).toBeGreaterThan(50);
    });

    it('prices every parcel the way the real calculator would', () => {
      for (const parcel of parcels) {
        expect(parcel.deliveryFee).toBe(
          calculateDeliveryFee(parcel.weightKg, parcel.codAmount).total,
        );
      }
    });
  });

  describe('status logs', () => {
    it('writes one entry per status the parcel passed through', () => {
      const expected: Record<string, number> = {
        PENDING: 1,
        PICKED_UP: 2,
        IN_TRANSIT: 3,
        OUT_FOR_DELIVERY: 4,
        DELIVERED: 5,
        CANCELLED: 2,
      };

      for (const parcel of parcels) {
        const own = logs.filter((l) => l.parcelId === parcel.id);
        expect(own).toHaveLength(expected[parcel.status]);
      }
    });

    it('ends each trail on the parcel current status', () => {
      for (const parcel of parcels) {
        const own = logs.filter((l) => l.parcelId === parcel.id);
        expect(own[own.length - 1].status).toBe(parcel.status);
      }
    });

    it('orders entries in time, which the dwell-time query depends on', () => {
      for (const parcel of parcels) {
        const times = logs
          .filter((l) => l.parcelId === parcel.id)
          .map((l) => new Date(l.createdAt).getTime());

        for (let i = 1; i < times.length; i++) {
          expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
        }
      }
    });

    it('never leaves two entries at the same instant on a multi-step parcel', () => {
      const multiStep = parcels.filter((p) => p.status === 'DELIVERED');

      for (const parcel of multiStep) {
        const times = logs
          .filter((l) => l.parcelId === parcel.id)
          .map((l) => new Date(l.createdAt).getTime());

        expect(new Set(times).size).toBe(times.length);
      }
    });
  });

  describe('determinism', () => {
    it('is reproducible, so a bug found here reproduces elsewhere', () => {
      const again = buildUsers('hashed-password');

      expect(again.map((u) => u.email)).toEqual(users.map((u) => u.email));
    });
  });

  describe('fee helper', () => {
    it('agrees with the production calculator', () => {
      for (const [weight, cod] of [
        [1, 0],
        [3, 0],
        [2.1, 5000],
        [9.9, 12000],
      ]) {
        expect(fee(weight, cod)).toBe(calculateDeliveryFee(weight, cod).total);
      }
    });
  });
});
