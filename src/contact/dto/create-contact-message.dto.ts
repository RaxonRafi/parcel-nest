import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export const CONTACT_TOPICS = [
  'sending',
  'tracking',
  'courier',
  'other',
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateContactMessageDto {
  @ApiProperty({ example: 'Zain Malik' })
  @IsString()
  @Length(2, 80, { message: 'Name must be between 2 and 80 characters' })
  @Transform(trim)
  name!: string;

  @ApiProperty({ format: 'email', example: 'zain@example.com' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(trim)
  email!: string;

  @ApiProperty({ enum: CONTACT_TOPICS, example: 'tracking' })
  @IsIn(CONTACT_TOPICS, {
    message: `Topic must be one of: ${CONTACT_TOPICS.join(', ')}`,
  })
  topic!: ContactTopic;

  @ApiPropertyOptional({ example: 'TRK-5789-2847' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  trackingId?: string;

  @ApiProperty({ example: 'My parcel has not moved since yesterday.' })
  @IsString()
  @Length(10, 2000, {
    message: 'Message must be between 10 and 2000 characters',
  })
  @Transform(trim)
  message!: string;
}
