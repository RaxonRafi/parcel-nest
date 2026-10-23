import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PHONE_REGEX } from '../../common/constants/validation.constants';
import { trimString } from '../../common/utils/trim.transform';
import { DeliveryZone, ServiceTier } from '../types/parcel.types';

/** One of `receiverId` / `receiverEmail` must be present. */
export class CreateParcelDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Existing receiver account. Omit it to have the receiver looked up (or created) by `receiverEmail`.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'receiverId must be a uuid' })
  receiverId?: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @IsNotEmpty({ message: 'Receiver name is required' })
  @MaxLength(120)
  @Transform(trimString)
  receiverName!: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  @IsOptional()
  @Matches(PHONE_REGEX, {
    message: 'receiverPhone must be a valid phone number',
  })
  receiverPhone?: string;

  @ApiPropertyOptional({
    format: 'email',
    example: 'jane@example.com',
    description: 'Required when `receiverId` is not supplied.',
  })
  // Enforces the either/or the service used to discover only at runtime.
  @ValidateIf((dto: CreateParcelDto) => !dto.receiverId)
  @IsEmail(
    {},
    { message: 'Either receiverId or a valid receiverEmail is required' },
  )
  @Transform(trimString)
  receiverEmail?: string;

  @ApiProperty({ example: '12 Gulshan Ave, Dhaka' })
  @IsString()
  @IsNotEmpty({ message: 'Pickup address is required' })
  @MaxLength(500)
  pickupAddress!: string;

  @ApiProperty({ example: '45 Agrabad, Chattogram' })
  @IsString()
  @IsNotEmpty({ message: 'Delivery address is required' })
  @MaxLength(500)
  deliveryAddress!: string;

  @ApiPropertyOptional({ example: 'Fragile — handle with care' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    default: 1,
    minimum: 0.01,
    maximum: 1000,
    description: 'Parcel weight in kilograms. Drives the delivery fee.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.01)
  @Max(1000)
  weightKg?: number;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Cash to collect from the receiver on delivery. 0 (the default) means prepaid.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  codAmount?: number;

  @ApiPropertyOptional({
    enum: DeliveryZone,
    default: DeliveryZone.DHAKA_CITY,
    description: 'Area the courier collects from. Drives the fee.',
  })
  @IsOptional()
  @IsEnum(DeliveryZone)
  pickupZone?: DeliveryZone;

  @ApiPropertyOptional({
    enum: DeliveryZone,
    default: DeliveryZone.DHAKA_CITY,
    description: 'Area the parcel is going to. Drives the fee.',
  })
  @IsOptional()
  @IsEnum(DeliveryZone)
  deliveryZone?: DeliveryZone;

  @ApiPropertyOptional({
    enum: ServiceTier,
    default: ServiceTier.STANDARD,
    description: 'EXPRESS is only offered when neither end is outside Dhaka.',
  })
  @IsOptional()
  @IsEnum(ServiceTier)
  serviceTier?: ServiceTier;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Start of the pickup slot. Send both ends or neither; the slot may be at most 12 hours long and start within 14 days.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  pickupWindowStart?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  pickupWindowEnd?: string;
}
