import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class IndexParcelDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id!: string;

  @ApiProperty({ example: 'TRK-12345' })
  @IsString()
  @IsNotEmpty()
  trackingCode!: string;

  @ApiProperty({ example: 'IN_TRANSIT' })
  @IsString()
  @IsNotEmpty()
  status!: string;

  @ApiProperty({ example: 'Dhaka' })
  @IsString()
  @IsNotEmpty()
  origin!: string;

  @ApiProperty({ example: 'Chattogram' })
  @IsString()
  @IsNotEmpty()
  destination!: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @IsNotEmpty()
  recipientName!: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-28T10:15:00.000Z' })
  @IsDateString()
  updatedAt!: string;

  @ApiPropertyOptional({ example: 'Left the Dhaka sorting hub' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Sender, receiver and courier ids. Non-admin users are only shown parcels that name them here, so a parcel indexed without them is visible to admins alone.',
  })
  @IsOptional()
  @IsUUID('4')
  senderId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  receiverId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  courierId?: string;
}
