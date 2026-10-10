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
import { trimString } from '../../common/utils/trim.transform';

export const CONTACT_TOPICS = [
  'sending',
  'tracking',
  'courier',
  'other',
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export class CreateContactMessageDto {
  @ApiProperty({ example: 'Zain Malik' })
  @IsString()
  @Length(2, 80, { message: 'Name must be between 2 and 80 characters' })
  @Transform(trimString)
  name!: string;

  @ApiProperty({ format: 'email', example: 'zain@example.com' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(trimString)
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
  @Transform(trimString)
  trackingId?: string;

  @ApiProperty({ example: 'My parcel has not moved since yesterday.' })
  @IsString()
  @Length(10, 2000, {
    message: 'Message must be between 10 and 2000 characters',
  })
  @Transform(trimString)
  message!: string;

  @ApiPropertyOptional({
    description:
      'Honeypot. Render it as a field people cannot see and leave it empty; a submission that fills it in is silently discarded.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
