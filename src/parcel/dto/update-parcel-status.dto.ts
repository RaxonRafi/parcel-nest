import { ParcelStatus } from '../types/parcel.types';

export class UpdateParcelStatusDto {
  status!: ParcelStatus;
  note?: string;
}
