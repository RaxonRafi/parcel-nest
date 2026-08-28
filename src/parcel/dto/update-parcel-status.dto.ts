import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParcelStatus } from '../types/parcel.types';

export class UpdateParcelStatusDto {
  @ApiProperty({ enum: ParcelStatus, example: ParcelStatus.IN_TRANSIT })
  status!: ParcelStatus;

  @ApiPropertyOptional({
    description: 'Free-text note stored on the status log entry.',
    example: 'Left the Dhaka sorting hub',
  })
  note?: string;
}
