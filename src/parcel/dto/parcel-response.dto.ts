import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({ type: [ParcelStatusLogResponseDto] })
  statusLogs?: ParcelStatusLogResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
