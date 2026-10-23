import { FeeBreakdownDto } from './quote-parcel.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/dto/paginated-response.dto';
import { UserResponseDto } from '../../user/dto/user-response.dto';
import {
  DeliveryFailureReason,
  DeliveryZone,
  ParcelStatus,
  PaymentStatus,
  ServiceTier,
} from '../types/parcel.types';

export class ParcelStatusLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ParcelStatus })
  status!: ParcelStatus;

  @ApiPropertyOptional({ example: 'Left the Dhaka sorting hub' })
  note?: string;

  @ApiPropertyOptional({ type: UserResponseDto })
  changedBy?: UserResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class ParcelResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'TRK-20260828-A1B2C3' })
  trackingId!: string;

  @ApiPropertyOptional({ type: UserResponseDto })
  sender?: UserResponseDto;

  @ApiPropertyOptional({ type: UserResponseDto })
  receiver?: UserResponseDto;

  @ApiPropertyOptional({
    type: UserResponseDto,
    nullable: true,
    description: 'Assigned courier, or null while the parcel is unassigned.',
  })
  deliveryPersonnel?: UserResponseDto | null;

  @ApiProperty({ example: 'John Sender' })
  senderName!: string;

  @ApiProperty({ example: 'Jane Doe' })
  receiverName!: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  senderPhone?: string;

  @ApiPropertyOptional({ example: '+8801800000000' })
  receiverPhone?: string;

  @ApiProperty({ example: '12 Gulshan Ave, Dhaka' })
  pickupAddress!: string;

  @ApiProperty({ example: '45 Agrabad, Chattogram' })
  deliveryAddress!: string;

  @ApiPropertyOptional({ example: 'Fragile — handle with care' })
  description?: string;

  @ApiProperty({ enum: ParcelStatus })
  status!: ParcelStatus;

  @ApiProperty({ default: false })
  isBlocked!: boolean;

  @ApiProperty({ example: 2.5, description: 'Kilograms.' })
  weightKg!: number;

  @ApiProperty({
    example: 110,
    description: 'Computed server-side from weight.',
  })
  deliveryFee!: number;

  @ApiProperty({ example: 0, description: 'Cash to collect. 0 means prepaid.' })
  codAmount!: number;

  @ApiProperty({ default: false })
  isCodCollected!: boolean;

  @ApiProperty({
    enum: PaymentStatus,
    description:
      'NOT_REQUIRED for cash on delivery (the fee comes out of the cash); UNPAID or PAID for a prepaid parcel.',
  })
  paymentStatus!: PaymentStatus;

  @ApiPropertyOptional({
    nullable: true,
    example: 30,
    description: 'Charged once the parcel is RETURNED_TO_SENDER.',
  })
  returnFee!: number | null;

  @ApiProperty({ enum: DeliveryZone })
  pickupZone!: DeliveryZone;

  @ApiProperty({ enum: DeliveryZone })
  deliveryZone!: DeliveryZone;

  @ApiProperty({ enum: ServiceTier })
  serviceTier!: ServiceTier;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  pickupWindowStart!: Date | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  pickupWindowEnd!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'Null on parcels booked before estimates existed.',
  })
  estimatedDeliveryAt!: Date | null;

  @ApiProperty({ example: 0, description: 'Failed attempts so far.' })
  deliveryAttempts!: number;

  @ApiPropertyOptional({ nullable: true, enum: DeliveryFailureReason })
  lastFailureReason!: DeliveryFailureReason | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  rescheduledFor!: Date | null;

  @ApiProperty({ type: [String], description: 'Proof-of-delivery image URLs.' })
  deliveryProofImages!: string[];

  @ApiPropertyOptional({ nullable: true })
  deliveryProofNote!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Neighbour at flat 4B' })
  receivedBy!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  deliveredAt!: Date | null;

  @ApiPropertyOptional({
    type: FeeBreakdownDto,
    nullable: true,
    description:
      'How `deliveryFee` was made up at booking. Null on parcels booked before the breakdown was recorded.',
  })
  feeBreakdown?: FeeBreakdownDto | null;

  @ApiPropertyOptional({
    type: [ParcelStatusLogResponseDto],
    description:
      'The timeline. Present on single-parcel responses; left out of lists.',
  })
  statusLogs?: ParcelStatusLogResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class PaginatedParcelsDto {
  @ApiProperty({ type: [ParcelResponseDto] })
  data!: ParcelResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

export class BulkBookingRowResultDto {
  @ApiProperty({ example: 2, description: 'CSV line number, header is 1.' })
  line!: number;

  @ApiPropertyOptional({ example: 'TRK-7K2M9QX4T1VB' })
  trackingId?: string;

  @ApiPropertyOptional({ example: 'That account cannot receive parcels' })
  error?: string;
}

export class BulkBookingResponseDto {
  @ApiProperty({ example: 48 })
  created!: number;

  @ApiProperty({ example: 2 })
  failed!: number;

  @ApiProperty({ type: [BulkBookingRowResultDto] })
  results!: BulkBookingRowResultDto[];
}

export class ReindexResponseDto {
  @ApiProperty({ example: '204 parcels re-indexed' })
  message!: string;

  @ApiProperty({ example: 204 })
  indexed!: number;

  @ApiProperty({
    example: 0,
    description: 'Vectors dropped because their parcel no longer exists.',
  })
  removed!: number;
}
