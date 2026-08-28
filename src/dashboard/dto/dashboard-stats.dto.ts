import { ApiProperty } from '@nestjs/swagger';
import { ParcelStatus } from '../../parcel/types/parcel.types';

export class DashboardStatsDto {
  @ApiProperty({ example: 128 })
  totalUsers!: number;

  @ApiProperty({ example: 120 })
  activeUsers!: number;

  @ApiProperty({ example: 8 })
  blockedUsers!: number;

  @ApiProperty({ example: 540 })
  totalParcels!: number;

  @ApiProperty({
    description: 'Parcel counts keyed by `ParcelStatus`.',
    additionalProperties: { type: 'integer' },
    example: { [ParcelStatus.PENDING]: 12, [ParcelStatus.DELIVERED]: 500 },
  })
  parcelsByStatus!: Record<string, number>;

  @ApiProperty({ example: 3 })
  blockedParcels!: number;
}
