import { ParcelStatus } from '../parcel.interface';

export class UpdateParcelStatusDto {
  status: ParcelStatus;
  note?: string;
}
