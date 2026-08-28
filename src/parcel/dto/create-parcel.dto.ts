/** One of `receiverId` / `receiverEmail` must be present. */
export class CreateParcelDto {
  receiverId?: string;
  receiverName!: string;
  receiverPhone?: string;
  receiverEmail?: string;
  pickupAddress!: string;
  deliveryAddress!: string;
  description?: string;
}
