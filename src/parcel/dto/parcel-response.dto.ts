import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/dto/paginated-response.dto';
import { UserResponseDto } from '../../user/dto/user-response.dto';
import { ParcelStatus } from '../types/parcel.types';

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

  @ApiProperty({ type: [String], description: 'Proof-of-delivery image URLs.' })
  deliveryProofImages!: string[];

  @ApiPropertyOptional({ nullable: true })
  deliveryProofNote!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Neighbour at flat 4B' })
  receivedBy!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  deliveredAt!: Date | null;

  @ApiPropertyOptional({ type: [ParcelStatusLogResponseDto] })
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
