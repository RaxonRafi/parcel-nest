import { User } from '../../user/entities/user.entity';
import { Parcel } from '../entities/parcel.entity';

/**
 * Strips the password hash from every user hanging off a parcel.
 *
 * `sanitizeUser` covers the `/api/users` routes, but parcels carry users as
 * loaded relations — `sender`, `receiver`, `deliveryPersonnel` and each
 * `statusLogs[].changedBy` — and those never passed through it. On the public
 * tracking route that exposed bcrypt hashes to anyone holding a tracking id.
 *
 * Mutates in place and returns the same instance, so the `Parcel` type is
 * preserved. Only ever applied to entities on their way out to a controller —
 * never to one that is about to be saved.
 */
export function sanitizeParcel<T extends Parcel>(parcel: T): T {
  stripPassword(parcel.sender);
  stripPassword(parcel.receiver);
  stripPassword(parcel.deliveryPersonnel);

  for (const log of parcel.statusLogs ?? []) {
    stripPassword(log.changedBy);
  }

  return parcel;
}

export function sanitizeParcels<T extends Parcel>(parcels: T[]): T[] {
  return parcels.map(sanitizeParcel);
}

function stripPassword(user?: User | null): void {
  if (user) {
    delete (user as Partial<User>).password;
  }
}
