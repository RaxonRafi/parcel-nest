export enum ParcelStatus {
  PENDING = 'PENDING',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

/**
 * Legal next states for each status. Previously `updateStatus` accepted any
 * value, so a parcel could jump PENDING → DELIVERED or move backwards out of
 * DELIVERED, leaving a history that contradicted itself.
 *
 * IN_TRANSIT may go straight to DELIVERED: not every route has a separate
 * out-for-delivery leg. DELIVERED and CANCELLED are terminal.
 */
export const PARCEL_STATUS_TRANSITIONS: Readonly<
  Record<ParcelStatus, readonly ParcelStatus[]>
> = {
  [ParcelStatus.PENDING]: [ParcelStatus.PICKED_UP, ParcelStatus.CANCELLED],
  [ParcelStatus.PICKED_UP]: [ParcelStatus.IN_TRANSIT, ParcelStatus.CANCELLED],
  [ParcelStatus.IN_TRANSIT]: [
    ParcelStatus.OUT_FOR_DELIVERY,
    ParcelStatus.DELIVERED,
    ParcelStatus.CANCELLED,
  ],
  [ParcelStatus.OUT_FOR_DELIVERY]: [
    ParcelStatus.DELIVERED,
    ParcelStatus.CANCELLED,
  ],
  [ParcelStatus.DELIVERED]: [],
  [ParcelStatus.CANCELLED]: [],
};

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
  senderName: string;
  receiverName: string;
  pickupAddress: string;
  deliveryAddress: string;
  description: string | null;
  /** First name only, so a tracking page can say who is delivering. */
  deliveryPersonnelName: string | null;
  statusLogs: PublicParcelStatusLog[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicParcelStatusLog {
  status: ParcelStatus;
  note: string | null;
  createdAt: Date;
}
