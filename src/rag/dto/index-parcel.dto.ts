import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IndexParcelDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'TRK-12345' })
  trackingCode!: string;

  @ApiProperty({ example: 'IN_TRANSIT' })
  status!: string;

  @ApiProperty({ example: 'Dhaka' })
  origin!: string;

  @ApiProperty({ example: 'Chattogram' })
  destination!: string;

  @ApiProperty({ example: 'Jane Doe' })
  recipientName!: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-28T10:15:00.000Z' })
  updatedAt!: string;

  @ApiPropertyOptional({ example: 'Left the Dhaka sorting hub' })
  notes?: string;
}
