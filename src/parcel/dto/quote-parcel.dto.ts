import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

/** The two inputs the fee depends on — the same bounds as booking. */
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
}

export class FeeBreakdownDto {
  @ApiProperty({ example: 60, description: 'Covers the first kilogram.' })
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

  @ApiProperty({
    example: 115,
    description: 'What the sender pays — never below the minimum fee.',
  })
  total!: number;
}
