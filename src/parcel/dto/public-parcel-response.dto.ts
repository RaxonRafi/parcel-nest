import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParcelStatus } from '../types/parcel.types';

export class PublicParcelStatusLogDto {
  @ApiProperty({ enum: ParcelStatus })
  status!: ParcelStatus;

  @ApiProperty({ nullable: true, example: 'Left the Dhaka sorting hub' })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

/** Deliberately carries no nested user records — see `toPublicParcel`. */
export class PublicParcelResponseDto {
  @ApiProperty({ example: 'TRK-20260828-A1B2C3' })
  trackingId!: string;

  @ApiProperty({ enum: ParcelStatus })
  status!: ParcelStatus;

  @ApiProperty({ default: false })
  isBlocked!: boolean;

  @ApiProperty({ example: 'John Sender' })
  senderName!: string;

  @ApiProperty({ example: 'Jane Doe' })
  receiverName!: string;

  @ApiProperty({ example: '12 Gulshan Ave, Dhaka' })
  pickupAddress!: string;

  @ApiProperty({ example: '45 Agrabad, Chattogram' })
  deliveryAddress!: string;

  @ApiProperty({ nullable: true, example: 'Fragile — handle with care' })
  description!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Cal',
    description: 'Courier first name, or null while unassigned.',
  })
  deliveryPersonnelName!: string | null;

  @ApiProperty({ type: [PublicParcelStatusLogDto] })
  statusLogs!: PublicParcelStatusLogDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
