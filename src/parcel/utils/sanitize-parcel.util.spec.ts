import { User } from '../../user/entities/user.entity';
import { Parcel } from '../entities/parcel.entity';
import { sanitizeParcel, sanitizeParcels } from './sanitize-parcel.util';

describe('sanitizeParcel', () => {
  const withPassword = (name: string): User =>
    ({ id: `${name}-id`, name, password: '$2b$10$hash' }) as User;

  const buildParcel = (): Parcel =>
    ({
      id: 'p1',
      trackingId: 'TRK-1',
      sender: withPassword('sender'),
      receiver: withPassword('receiver'),
      deliveryPersonnel: withPassword('courier'),
      statusLogs: [
        { id: 'l1', changedBy: withPassword('admin') },
        { id: 'l2', changedBy: null },
      ],
    }) as unknown as Parcel;

  it('strips the hash from every nested user', () => {
    const parcel = sanitizeParcel(buildParcel());

    expect(parcel.sender).not.toHaveProperty('password');
    expect(parcel.receiver).not.toHaveProperty('password');
    expect(parcel.deliveryPersonnel).not.toHaveProperty('password');
    expect(parcel.statusLogs[0].changedBy).not.toHaveProperty('password');
  });

  it('keeps the rest of each user intact', () => {
    const parcel = sanitizeParcel(buildParcel());

    expect(parcel.sender.name).toBe('sender');
    expect(parcel.deliveryPersonnel?.name).toBe('courier');
    expect(parcel.trackingId).toBe('TRK-1');
  });

  it('tolerates an unassigned courier and a null changedBy', () => {
    const parcel = buildParcel();
    parcel.deliveryPersonnel = null;

    expect(() => sanitizeParcel(parcel)).not.toThrow();
    expect(parcel.statusLogs[1].changedBy).toBeNull();
  });

  it('tolerates a parcel with no status logs loaded', () => {
    const parcel = buildParcel();
    parcel.statusLogs = undefined as unknown as Parcel['statusLogs'];

    expect(() => sanitizeParcel(parcel)).not.toThrow();
  });

  it('sanitizes a list', () => {
    const list = sanitizeParcels([buildParcel(), buildParcel()]);

    for (const parcel of list) {
      expect(parcel.sender).not.toHaveProperty('password');
    }
  });
});
