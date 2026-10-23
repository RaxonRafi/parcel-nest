import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { DeliveryZone, RouteType, ServiceTier } from '../types/parcel.types';

/** The inputs the fee depends on — the same bounds as booking. */
export class QuoteParcelDto {
  @ApiPropertyOptional({ default: 1, minimum: 0.01, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.01)
  @Max(1000)
  weightKg?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  codAmount?: number;

  @ApiPropertyOptional({ enum: DeliveryZone, default: DeliveryZone.DHAKA_CITY })
  @IsOptional()
  @IsEnum(DeliveryZone)
  pickupZone?: DeliveryZone;

  @ApiPropertyOptional({ enum: DeliveryZone, default: DeliveryZone.DHAKA_CITY })
  @IsOptional()
  @IsEnum(DeliveryZone)
  deliveryZone?: DeliveryZone;

  @ApiPropertyOptional({ enum: ServiceTier, default: ServiceTier.STANDARD })
  @IsOptional()
  @IsEnum(ServiceTier)
  serviceTier?: ServiceTier;
}

export class FeeBreakdownDto {
  @ApiPropertyOptional({
    enum: RouteType,
    description:
      'CITY, SUBURB or NATIONAL, from the two zones. Absent on parcels booked before zones existed.',
  })
  route?: RouteType;

  @ApiPropertyOptional({ enum: ServiceTier })
  serviceTier?: ServiceTier;

  @ApiProperty({
    example: 60,
    description: 'Set by the route; covers the first kilogram.',
  })
  baseFee!: number;

  @ApiProperty({
    example: 50,
    description: 'Each kilogram beyond the included weight, rounded up.',
  })
  weightFee!: number;

  @ApiProperty({
    example: 5,
    description: 'A percentage of the cash to be collected on delivery.',
  })
  codFee!: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Flat surcharge for EXPRESS.',
  })
  expressFee?: number;

  @ApiProperty({
    example: 115,
    description: 'What the sender pays — never below the minimum fee.',
  })
  total!: number;
}
