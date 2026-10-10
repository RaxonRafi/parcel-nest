import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/dto/paginated-response.dto';

export class NotificationResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The same id the live `notification` socket event carries.',
  })
  id!: string;

  @ApiProperty({ example: 'parcel.status' })
  type!: string;

  @ApiProperty({ example: 'Parcel out for delivery' })
  title!: string;

  @ApiProperty({ example: 'TRK-7K2M9QX4T1VB is now out for delivery' })
  message!: string;

  @ApiProperty({ nullable: true, example: 'TRK-7K2M9QX4T1VB' })
  trackingId!: string | null;

  @ApiProperty({ nullable: true, example: 'OUT_FOR_DELIVERY' })
  status!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  readAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class PaginatedNotificationsDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  data!: NotificationResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  unread!: number;
}
