import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ParcelStatus } from '../types/parcel.types';

export class UpdateParcelStatusDto {
  @ApiProperty({ enum: ParcelStatus, example: ParcelStatus.IN_TRANSIT })
  @IsEnum(ParcelStatus, {
    message: `status must be one of: ${Object.values(ParcelStatus).join(', ')}`,
  })
  status!: ParcelStatus;

  @ApiPropertyOptional({
    description: 'Free-text note stored on the status log entry.',
    example: 'Left the Dhaka sorting hub',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
