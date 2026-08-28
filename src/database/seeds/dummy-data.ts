/**
 * Pure data generation for the development seed.
 *
 * Split out of the migration so it can be unit tested without a database —
 * referential integrity, status/log consistency and fee arithmetic are exactly
 * the things worth checking, and none of them need Postgres.
 */
const DAY = 86_400_000;
export const WINDOW_DAYS = 90;

/**
 * Deterministic PRNG (mulberry32). A fixed seed means two developers running
 * this get identical data, so a bug reproduces instead of shifting under you.
 */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20260828);

const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(random() * items.length)];

const between = (min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));

const uuid = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const FIRST = [
  'Rafi',
  'Nusrat',
  'Tanvir',
  'Sadia',
  'Imran',
  'Farhana',
  'Shakib',
  'Mim',
  'Arif',
  'Tasnim',
  'Rakib',
  'Jhumur',
  'Nayeem',
  'Sumaiya',
  'Hasan',
  'Ritu',
  'Sabbir',
  'Anika',
  'Fahim',
  'Lamia',
];
const LAST = [
  'Ahmed',
  'Hossain',
  'Rahman',
  'Islam',
  'Chowdhury',
  'Karim',
  'Alam',
  'Siddique',
  'Bhuiyan',
  'Mahmud',
];
const CITIES = [
  'Gulshan, Dhaka',
  'Dhanmondi, Dhaka',
  'Uttara, Dhaka',
  'Agrabad, Chattogram',
  'Zindabazar, Sylhet',
  'Kazir Dewri, Chattogram',
  'Rajshahi Sadar',
  'Khulna Sadar',
  'Barishal Sadar',
  'Rangpur Sadar',
];
const GOODS = [
  'Documents',
  'Electronics — fragile',
  'Clothing',
  'Books',
  'Cosmetics',
  'Spare parts',
  'Medical supplies',
  'Gift box',
  null,
];

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  phone: string;
  address: string;
  isActive: string;
  isVerified: boolean;
  createdAt: string;
}

export function buildUsers(password: string): SeedUser[] {
  const roles = [
    ...Array<string>(2).fill('ADMIN'),
    ...Array<string>(14).fill('SENDER'),
    ...Array<string>(14).fill('RECEIVER'),
    ...Array<string>(7).fill('DELIVERY_PERSONNEL'),
    ...Array<string>(3).fill('PENDING_DELIVERY'),
  ];

  return roles.map((role, i) => {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    return {
      id: uuid(),
      name,
      email: `${role.toLowerCase().replace('_', '')}${i + 1}@seed.local`,
      password,
      role,
      phone: `+8801${between(3, 9)}${between(10000000, 99999999)}`,
      address: pick(CITIES),
      // A couple of blocked accounts so the admin filters have something to find.
      isActive: i === 5 || i === 21 ? 'BLOCKED' : 'ACTIVE',
      isVerified: random() > 0.25,
      createdAt: new Date(
        Date.now() - between(WINDOW_DAYS, WINDOW_DAYS + 60) * DAY,
      ).toISOString(),
    };
  });
}

export interface SeedParcel {
  id: string;
  trackingId: string;
  senderId: string;
  receiverId: string;
  courierId: string;
  senderName: string;
  receiverName: string;
  senderPhone: string;
  receiverPhone: string;
  pickupAddress: string;
  deliveryAddress: string;
  description: string | null;
  status: string;
  isBlocked: boolean;
  weightKg: number;
  deliveryFee: number;
  codAmount: number;
  isCodCollected: boolean;
  receivedBy: string;
  deliveredAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `calculateDeliveryFee` — kept in sync by the spec on that util. */
export function fee(weightKg: number, codAmount: number): number {
  const weightFee = Math.ceil(Math.max(0, weightKg - 1)) * 25;
  const codFee = Math.round(codAmount * 0.01 * 100) / 100;
  return Math.max(60, Math.round((60 + weightFee + codFee) * 100) / 100);
}

export function buildParcels(
  senders: SeedUser[],
  receivers: SeedUser[],
  couriers: SeedUser[],
): SeedParcel[] {
  // Weighted so the data looks like a working business: mostly delivered,
  // a live tail in transit, a few cancelled.
  const statuses = [
    ...Array<string>(110).fill('DELIVERED'),
    ...Array<string>(20).fill('IN_TRANSIT'),
    ...Array<string>(18).fill('OUT_FOR_DELIVERY'),
    ...Array<string>(20).fill('PICKED_UP'),
    ...Array<string>(20).fill('PENDING'),
    ...Array<string>(12).fill('CANCELLED'),
  ];

  return statuses.map((status, i) => {
    const sender = pick(senders);
    const receiver = pick(receivers);
    const isClosed = status === 'DELIVERED' || status === 'CANCELLED';
    const needsCourier = status !== 'PENDING' && status !== 'CANCELLED';
    const courier = needsCourier ? pick(couriers) : null;

    const createdAt = new Date(
      Date.now() - between(0, WINDOW_DAYS) * DAY - between(0, 23) * 3_600_000,
    );
    // Delivered parcels take somewhere between a few hours and four days.
    const deliveredAt =
      status === 'DELIVERED'
        ? new Date(createdAt.getTime() + between(4, 96) * 3_600_000)
        : null;

    const weightKg = Math.round((0.5 + random() * 9.5) * 10) / 10;
    const codAmount = random() > 0.65 ? between(500, 12000) : 0;

    return {
      id: uuid(),
      trackingId: `TRK-SEED-${String(i + 1).padStart(4, '0')}`,
      senderId: sender.id,
      receiverId: receiver.id,
      courierId: courier?.id ?? '',
      senderName: sender.name,
      receiverName: receiver.name,
      senderPhone: sender.phone,
      receiverPhone: receiver.phone,
      pickupAddress: sender.address,
      deliveryAddress: receiver.address,
      description: pick(GOODS),
      status,
      isBlocked: random() > 0.97,
      weightKg,
      deliveryFee: fee(weightKg, codAmount),
      codAmount,
      isCodCollected: status === 'DELIVERED' && codAmount > 0,
      receivedBy: status === 'DELIVERED' ? receiver.name : '',
      deliveredAt: deliveredAt?.toISOString() ?? '',
      createdAt: createdAt.toISOString(),
      updatedAt: (deliveredAt ?? createdAt).toISOString(),
    };
  });
}

/** The path a parcel took to reach its current status. */
const PATH: Record<string, string[]> = {
  PENDING: ['PENDING'],
  PICKED_UP: ['PENDING', 'PICKED_UP'],
  IN_TRANSIT: ['PENDING', 'PICKED_UP', 'IN_TRANSIT'],
  OUT_FOR_DELIVERY: ['PENDING', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'],
  DELIVERED: [
    'PENDING',
    'PICKED_UP',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ],
  CANCELLED: ['PENDING', 'CANCELLED'],
};

const NOTES: Record<string, string> = {
  PENDING: 'Parcel created',
  PICKED_UP: 'Collected from sender',
  IN_TRANSIT: 'Left the origin hub',
  OUT_FOR_DELIVERY: 'With the courier for final delivery',
  DELIVERED: 'Delivered and signed for',
  CANCELLED: 'Cancelled by sender',
};

export interface SeedLog {
  parcelId: string;
  status: string;
  note: string;
  changedById: string;
  createdAt: string;
}

export function buildStatusLogs(parcels: SeedParcel[]): SeedLog[] {
  const logs: SeedLog[] = [];

  for (const parcel of parcels) {
    const path = PATH[parcel.status] ?? ['PENDING'];
    const start = new Date(parcel.createdAt).getTime();
    const end = parcel.deliveredAt
      ? new Date(parcel.deliveredAt).getTime()
      : start + between(2, 72) * 3_600_000;
    // Spread entries evenly across the parcel's life so dwell times are sane.
    const step = path.length > 1 ? (end - start) / (path.length - 1) : 0;

    path.forEach((status, i) => {
      logs.push({
        parcelId: parcel.id,
        status,
        note: NOTES[status],
        changedById: i === 0 ? parcel.senderId : parcel.courierId,
        createdAt: new Date(start + step * i).toISOString(),
      });
    });
  }

  return logs;
}
