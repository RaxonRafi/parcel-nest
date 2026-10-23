import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { DeliveryFailureReason } from '../types/parcel.types';

export class FailedAttemptDto {
  @ApiProperty({
    enum: DeliveryFailureReason,
    example: DeliveryFailureReason.RECEIVER_UNAVAILABLE,
  })
  @IsEnum(DeliveryFailureReason)
  reason!: DeliveryFailureReason;

  @ApiPropertyOptional({ example: 'Gate locked, phone off' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When the receiver asked to be tried again. Must be in the next 14 days.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  rescheduledFor?: string;
}

export class RescheduleDeliveryDto {
  @ApiProperty({
    format: 'date-time',
    description: 'When to try again. Must be in the next 14 days.',
  })
  @IsISO8601({ strict: true })
  rescheduledFor!: string;

  @ApiPropertyOptional({ example: 'Home after 6pm' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
