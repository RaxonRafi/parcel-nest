import { firstName } from '../../common/utils/name.util';
import { Parcel } from '../entities/parcel.entity';
import { PublicParcel } from '../types/parcel.types';

/**
 * Projects a parcel down to what is safe to hand anyone holding a tracking id.
 *
 * Built as an explicit allow-list rather than by deleting fields: a new column
 * on `Parcel` then stays private until someone deliberately adds it here.
 */
export function toPublicParcel(parcel: Parcel): PublicParcel {
  return {
    trackingId: parcel.trackingId,
    status: parcel.status,
    isBlocked: parcel.isBlocked,
    senderName: parcel.senderName,
    receiverName: parcel.receiverName,
    pickupAddress: parcel.pickupAddress,
    deliveryAddress: parcel.deliveryAddress,
    description: parcel.description ?? null,
    deliveryPersonnelName: firstName(parcel.deliveryPersonnel?.name),
    statusLogs: (parcel.statusLogs ?? []).map((log) => ({
      status: log.status,
      note: log.note ?? null,
      createdAt: log.createdAt,
    })),
    createdAt: parcel.createdAt,
    updatedAt: parcel.updatedAt,
  };
}
