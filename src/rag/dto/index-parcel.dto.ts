export class IndexParcelDto {
  id!: string;
  trackingCode!: string;
  status!: string;
  origin!: string;
  destination!: string;
  recipientName!: string;
  updatedAt!: string;
  notes?: string;
}
