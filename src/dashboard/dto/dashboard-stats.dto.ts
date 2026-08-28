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

export class DailyCountDto {
  @ApiProperty({ example: '2026-08-28' })
  date!: string;

  @ApiProperty({ example: 12 })
  created!: number;

  @ApiProperty({ example: 9 })
  delivered!: number;
}

export class StatusTimingDto {
  @ApiProperty({ enum: ParcelStatus })
  status!: string;

  @ApiProperty({
    nullable: true,
    example: 6.25,
    description: 'Mean hours in this status before moving on.',
  })
  averageHours!: number | null;

  @ApiProperty({ example: 42 })
  sampleSize!: number;
}

export class CourierThroughputDto {
  @ApiProperty({ format: 'uuid' })
  courierId!: string;

  @ApiProperty({ example: 'Cal Rahman' })
  courierName!: string;

  @ApiProperty({ example: 3 })
  active!: number;

  @ApiProperty({ example: 118 })
  delivered!: number;

  @ApiProperty({ nullable: true, example: 21.4 })
  averageDeliveryHours!: number | null;
}

export class RevenueSummaryDto {
  @ApiProperty({ example: 48200 })
  deliveryFeesBooked!: number;

  @ApiProperty({ example: 41100 })
  deliveryFeesDelivered!: number;

  @ApiProperty({ example: 12500, description: 'COD not yet collected.' })
  codOutstanding!: number;

  @ApiProperty({ example: 96000 })
  codCollected!: number;
}

export class DashboardTrendsDto {
  @ApiProperty({ example: 30 })
  rangeDays!: number;

  @ApiProperty({ type: [DailyCountDto] })
  daily!: DailyCountDto[];

  @ApiProperty({ type: [StatusTimingDto] })
  statusTimings!: StatusTimingDto[];

  @ApiProperty({ type: [CourierThroughputDto] })
  courierThroughput!: CourierThroughputDto[];

  @ApiProperty({ type: RevenueSummaryDto })
  revenue!: RevenueSummaryDto;

  @ApiProperty({ nullable: true, example: 28.7 })
  averageFulfilmentHours!: number | null;
}
