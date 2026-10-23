import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DeliveryZone } from '../types/parcel.types';

/**
 * The multipart form for a booking file. Besides the file, a merchant
 * usually ships everything from one warehouse, so the pickup details can be
 * given once here and left out of the rows.
 */
export class BulkBookingDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'CSV with a header row. Columns are the booking fields: receiverName, receiverEmail (or receiverId), receiverPhone, pickupAddress, deliveryAddress, description, weightKg, codAmount, pickupZone, deliveryZone, serviceTier, pickupWindowStart, pickupWindowEnd. At most 500 rows, 1 MB.',
  })
  file!: unknown;

  @ApiPropertyOptional({
    description: 'Used for every row whose pickupAddress cell is empty.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pickupAddress?: string;

  @ApiPropertyOptional({ enum: DeliveryZone })
  @IsOptional()
  @IsEnum(DeliveryZone)
  pickupZone?: DeliveryZone;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  pickupWindowStart?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  pickupWindowEnd?: string;
}
