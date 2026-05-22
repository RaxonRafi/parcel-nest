export class CreateParcelDto {
  receiverId: string;
  receiverName: string;
  receiverPhone?: string;
  pickupAddress: string;
  deliveryAddress: string;
  description?: string;
}
