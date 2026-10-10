import { firstName } from '../../common/utils/name.util';
import { Parcel } from '../entities/parcel.entity';
import { PublicParcel } from '../types/parcel.types';

/**
 * Projects a parcel down to what is safe to hand anyone holding a tracking id.
 *
 * Built as an explicit allow-list rather than by deleting fields: a new column
 * on `Parcel` then stays private until someone deliberately adds it here.
 *
 * A tracking id is not a secret — it is printed on the label and pasted into
 * chats — so this is what a stranger sees. They learn where the parcel is
 * headed and how far along it is, not which door it goes to or the full names
 * of the people at either end. The parties themselves get the full record
 * from the authenticated `details` route.
 */
export function toPublicParcel(parcel: Parcel): PublicParcel {
  return {
    trackingId: parcel.trackingId,
    status: parcel.status,
    isBlocked: parcel.isBlocked,
    senderName: maskName(parcel.senderName),
    receiverName: maskName(parcel.receiverName),
    pickupAddress: toArea(parcel.pickupAddress),
    deliveryAddress: toArea(parcel.deliveryAddress),
    description: parcel.description ?? null,
    deliveryPersonnelName: firstName(parcel.deliveryPersonnel?.name),
    statusLogs: (parcel.statusLogs ?? []).map((log) => ({
      status: log.status,
      note: publicNote(log.note),
      createdAt: log.createdAt,
    })),
    createdAt: parcel.createdAt,
    updatedAt: parcel.updatedAt,
  };
}

/** "Jane Doe" → "Jane D."; a single name is left as it is. */
export function maskName(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/**
 * Reduces an address to its area.
 *
 * Addresses are free text, so this leans on how people write them — most
 * specific part first. With commas, the first part (house and street) is
 * dropped and the last two kept: "House 12, Road 5, Gulshan, Dhaka" becomes
 * "Gulshan, Dhaka". Without commas only the last two words survive, which is
 * where the city sits. A single-part address is already just a place name.
 */
export function toArea(address?: string | null): string {
  const parts = (address ?? '')
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.slice(1).slice(-2).join(', ');
  }

  const words = (parts[0] ?? '').split(/\s+/).filter(Boolean);
  return words.length > 2 ? words.slice(-2).join(' ') : words.join(' ');
}

/**
 * The handover note names whoever took the parcel — "Delivered to Rahim
 * Uddin" — which is the full name the rest of this projection withholds.
 */
function publicNote(note?: string | null): string | null {
  if (!note) return null;
  return note.startsWith('Delivered to ') ? 'Delivered' : note;
}
