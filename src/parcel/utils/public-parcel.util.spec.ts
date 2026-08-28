import { Parcel } from '../entities/parcel.entity';
import { ParcelStatus } from '../types/parcel.types';
import { toPublicParcel } from './public-parcel.util';

describe('toPublicParcel', () => {
  const buildParcel = (overrides: Partial<Parcel> = {}): Parcel =>
    ({
      id: 'internal-uuid',
      trackingId: 'TRK-1',
      status: ParcelStatus.IN_TRANSIT,
      isBlocked: false,
      senderName: 'John Sender',
      receiverName: 'Jane Doe',
      senderPhone: '+880170000000',
      receiverPhone: '+880180000000',
      pickupAddress: 'Dhaka',
      deliveryAddress: 'Chattogram',
      description: null,
      sender: { id: 's', email: 's@x.com', nidNumber: '123' },
      receiver: { id: 'r', email: 'r@x.com', nidNumber: '456' },
      deliveryPersonnel: { id: 'c', name: 'Cal Rahman', email: 'c@x.com' },
      statusLogs: [
        {
          status: ParcelStatus.PENDING,
          note: 'Parcel created',
          createdAt: new Date('2026-01-01'),
          changedBy: { id: 'a', email: 'admin@x.com' },
        },
      ],
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      ...overrides,
    }) as unknown as Parcel;

  it('drops every nested user record', () => {
    const view = toPublicParcel(buildParcel()) as unknown as Record<
      string,
      any
    >;

    expect(view.sender).toBeUndefined();
    expect(view.receiver).toBeUndefined();
    expect(view.deliveryPersonnel).toBeUndefined();
    expect(view.statusLogs[0]).not.toHaveProperty('changedBy');
  });

  it('withholds the internal id and both phone numbers', () => {
    const view = toPublicParcel(buildParcel()) as unknown as Record<
      string,
      any
    >;

    expect(view.id).toBeUndefined();
    expect(view.senderPhone).toBeUndefined();
    expect(view.receiverPhone).toBeUndefined();
  });

  it('reduces the courier to a first name', () => {
    expect(toPublicParcel(buildParcel()).deliveryPersonnelName).toBe('Cal');
  });

  it('reports no courier when none is assigned', () => {
    const view = toPublicParcel(buildParcel({ deliveryPersonnel: null }));

    expect(view.deliveryPersonnelName).toBeNull();
  });

  it('keeps the tracking essentials', () => {
    const view = toPublicParcel(buildParcel());

    expect(view.trackingId).toBe('TRK-1');
    expect(view.status).toBe(ParcelStatus.IN_TRANSIT);
    expect(view.statusLogs).toHaveLength(1);
    expect(view.statusLogs[0].note).toBe('Parcel created');
  });

  it('survives a parcel with no logs loaded', () => {
    const view = toPublicParcel(
      buildParcel({ statusLogs: undefined as unknown as Parcel['statusLogs'] }),
    );

    expect(view.statusLogs).toEqual([]);
  });
});
