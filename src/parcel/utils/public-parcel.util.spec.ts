import { Parcel } from '../entities/parcel.entity';
import { ParcelStatus } from '../types/parcel.types';
import { maskName, toArea, toPublicParcel } from './public-parcel.util';

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
      pickupAddress: 'House 12, Road 5, Gulshan, Dhaka',
      deliveryAddress: '45 Agrabad, Chattogram',
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

  it('shows the area, never the door', () => {
    const view = toPublicParcel(buildParcel());

    expect(view.pickupAddress).toBe('Gulshan, Dhaka');
    expect(view.deliveryAddress).toBe('Chattogram');
    expect(JSON.stringify(view)).not.toContain('House 12');
    expect(JSON.stringify(view)).not.toContain('45 Agrabad');
  });

  it('shows who, but not their full name', () => {
    const view = toPublicParcel(buildParcel());

    expect(view.senderName).toBe('John S.');
    expect(view.receiverName).toBe('Jane D.');
  });

  it('does not let the handover note name whoever signed', () => {
    const view = toPublicParcel(
      buildParcel({
        statusLogs: [
          {
            status: ParcelStatus.DELIVERED,
            note: 'Delivered to Rahim Uddin',
            createdAt: new Date('2026-01-03'),
          },
        ] as unknown as Parcel['statusLogs'],
      }),
    );

    expect(view.statusLogs[0].note).toBe('Delivered');
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

describe('toArea', () => {
  it.each([
    ['House 12, Road 5, Gulshan, Dhaka', 'Gulshan, Dhaka'],
    ['45 Agrabad, Chattogram', 'Chattogram'],
    ['Flat 4B\nBanani\nDhaka', 'Banani, Dhaka'],
    ['House 12 Road 5 Dhanmondi Dhaka', 'Dhanmondi Dhaka'],
    ['Dhaka', 'Dhaka'],
    ['Cox Bazar', 'Cox Bazar'],
    ['  ,  ', ''],
    ['', ''],
  ])('%p → %p', (address, area) => {
    expect(toArea(address)).toBe(area);
  });

  it('copes with a missing address', () => {
    expect(toArea(null)).toBe('');
    expect(toArea(undefined)).toBe('');
  });
});

describe('maskName', () => {
  it.each([
    ['Jane Doe', 'Jane D.'],
    ['  jane   van  doe ', 'jane D.'],
    ['Madonna', 'Madonna'],
    ['', ''],
  ])('%p → %p', (name, masked) => {
    expect(maskName(name)).toBe(masked);
  });

  it('copes with a missing name', () => {
    expect(maskName(null)).toBe('');
  });
});
