export enum ParcelStatus {
  PENDING = 'PENDING',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  /** The courier reached the door and could not hand it over. */
  FAILED_ATTEMPT = 'FAILED_ATTEMPT',
  /** On its way back to the sender. */
  RETURNING = 'RETURNING',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  RETURNED_TO_SENDER = 'RETURNED_TO_SENDER',
}

/**
 * Legal next states for each status. Previously `updateStatus` accepted any
 * value, so a parcel could jump PENDING → DELIVERED or move backwards out of
 * DELIVERED, leaving a history that contradicted itself.
 *
 * IN_TRANSIT may go straight to DELIVERED: not every route has a separate
 * out-for-delivery leg. A failed attempt goes back out for delivery (the
 * retry) or starts the return. DELIVERED, CANCELLED and RETURNED_TO_SENDER
 * are terminal.
 */
export const PARCEL_STATUS_TRANSITIONS: Readonly<
  Record<ParcelStatus, readonly ParcelStatus[]>
> = {
  [ParcelStatus.PENDING]: [ParcelStatus.PICKED_UP, ParcelStatus.CANCELLED],
  [ParcelStatus.PICKED_UP]: [ParcelStatus.IN_TRANSIT, ParcelStatus.CANCELLED],
  [ParcelStatus.IN_TRANSIT]: [
    ParcelStatus.OUT_FOR_DELIVERY,
    ParcelStatus.DELIVERED,
    ParcelStatus.RETURNING,
    ParcelStatus.CANCELLED,
  ],
  [ParcelStatus.OUT_FOR_DELIVERY]: [
    ParcelStatus.DELIVERED,
    ParcelStatus.FAILED_ATTEMPT,
    ParcelStatus.CANCELLED,
  ],
  [ParcelStatus.FAILED_ATTEMPT]: [
    ParcelStatus.OUT_FOR_DELIVERY,
    ParcelStatus.RETURNING,
    ParcelStatus.CANCELLED,
  ],
  [ParcelStatus.RETURNING]: [ParcelStatus.RETURNED_TO_SENDER],
  [ParcelStatus.DELIVERED]: [],
  [ParcelStatus.CANCELLED]: [],
  [ParcelStatus.RETURNED_TO_SENDER]: [],
};

/** A parcel in one of these states is finished — nothing more happens to it. */
export const CLOSED_STATUSES: readonly ParcelStatus[] = [
  ParcelStatus.DELIVERED,
  ParcelStatus.CANCELLED,
  ParcelStatus.RETURNED_TO_SENDER,
];

/** Why a delivery attempt failed. Persisted, so treat as append-only. */
export enum DeliveryFailureReason {
  RECEIVER_UNAVAILABLE = 'RECEIVER_UNAVAILABLE',
  RECEIVER_UNREACHABLE = 'RECEIVER_UNREACHABLE',
  WRONG_ADDRESS = 'WRONG_ADDRESS',
  REFUSED = 'REFUSED',
  RESCHEDULE_REQUESTED = 'RESCHEDULE_REQUESTED',
  OTHER = 'OTHER',
}

/**
 * Coarse delivery areas, the way couriers in Bangladesh price: inside Dhaka
 * city, the Dhaka suburbs (Savar, Gazipur, Narayanganj, Keraniganj…), and
 * everywhere else. Addresses are free text, so the sender picks the zone.
 */
export enum DeliveryZone {
  DHAKA_CITY = 'DHAKA_CITY',
  DHAKA_SUBURB = 'DHAKA_SUBURB',
  OUTSIDE_DHAKA = 'OUTSIDE_DHAKA',
}

/** The kind of journey a pickup zone and a delivery zone make together. */
export enum RouteType {
  CITY = 'CITY',
  SUBURB = 'SUBURB',
  NATIONAL = 'NATIONAL',
}

export enum ServiceTier {
  STANDARD = 'STANDARD',
  EXPRESS = 'EXPRESS',
}

/**
 * How the delivery fee is settled.
 *
 * - `NOT_REQUIRED`: cash on delivery — the fee comes out of the cash the
 *   courier collects, so nobody pays it separately.
 * - `UNPAID` / `PAID`: prepaid — the sender owes the fee, and settles it
 *   online or has it netted against their balance.
 */
export enum PaymentStatus {
  NOT_REQUIRED = 'NOT_REQUIRED',
  UNPAID = 'UNPAID',
  PAID = 'PAID',
}

export interface ParcelStats {
  totalParcels: number;
  blockedParcels: number;
  parcelsByStatus: Record<string, number>;
}

/** Payload shipped to the RAG index whenever a parcel changes. */
export interface ParcelIndexDocument {
  id: string;
  trackingCode: string;
  status: string;
  origin: string;
  destination: string;
  recipientName: string;
  updatedAt: string;
  notes?: string;
  /** The only non-admin accounts the assistant may show this parcel to. */
  senderId?: string;
  receiverId?: string;
  courierId?: string;
}

/**
 * What `GET /api/parcels/:trackingId` returns. That route is public — anyone
 * holding a tracking code reaches it — so it deliberately carries no nested
 * user objects. The full `Parcel`, with `sender` / `receiver` /
 * `deliveryPersonnel` records attached, is only served to authenticated routes.
 */
export interface PublicParcel {
  trackingId: string;
  status: ParcelStatus;
  isBlocked: boolean;
  /** First name and last initial — "Jane D.". */
  senderName: string;
  receiverName: string;
  /** The area only — "Gulshan, Dhaka" — never the street address. */
  pickupAddress: string;
  deliveryAddress: string;
  description: string | null;
  /** First name only, so a tracking page can say who is delivering. */
  deliveryPersonnelName: string | null;
  serviceTier: ServiceTier;
  /** When the parcel is expected at the door. Null for older parcels. */
  estimatedDeliveryAt: Date | null;
  deliveryAttempts: number;
  /** Set when a failed attempt was rescheduled for a particular day. */
  rescheduledFor: Date | null;
  statusLogs: PublicParcelStatusLog[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicParcelStatusLog {
  status: ParcelStatus;
  note: string | null;
  createdAt: Date;
}
