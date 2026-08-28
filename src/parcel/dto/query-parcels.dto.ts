import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ParcelStatus } from '../types/parcel.types';

export class QueryParcelsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ParcelStatus })
  @IsOptional()
  @IsEnum(ParcelStatus)
  status?: ParcelStatus;

  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match on tracking id, sender name or receiver name.',
    example: 'TRK-2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ description: 'Created on or after this date.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Created on or before this date.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Admin filter for blocked parcels.' })
  @IsOptional()
  // Query strings carry "true"/"false", which @IsBoolean would otherwise reject.
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isBlocked?: boolean;

  @ApiPropertyOptional({
    description: 'Admin filter: only parcels with no courier assigned.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassigned?: boolean;
}
