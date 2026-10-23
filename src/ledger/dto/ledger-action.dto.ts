import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from '../../common/utils/trim.transform';
import { PayoutMethod } from '../types/ledger.types';

export class CourierDepositDto {
  @ApiProperty({ example: 2000, description: 'Cash handed in, in BDT.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount!: number;

  @ApiPropertyOptional({ example: 'HUB-RCPT-0042' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimString)
  reference?: string;

  @ApiPropertyOptional({ example: 'Evening hand-in at the Gulshan hub' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MerchantPayoutDto {
  @ApiProperty({ example: 1895, description: 'Amount sent, in BDT.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount!: number;

  @ApiProperty({ enum: PayoutMethod, example: PayoutMethod.BKASH })
  @IsEnum(PayoutMethod)
  method!: PayoutMethod;

  @ApiPropertyOptional({
    example: '9F3K2LQ1',
    description: 'Bank or wallet transaction id.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimString)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
