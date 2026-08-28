/**
 * Placeholder account created for a parcel receiver who has not registered yet.
 * Used by `ParcelService` so it never has to touch the user repository.
 */
export class CreateReceiverDto {
  name!: string;
  email!: string;
  phone?: string;
}
