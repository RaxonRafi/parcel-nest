import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { PHONE_REGEX } from '../../common/constants/validation.constants';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Sender' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone?: string;

  @ApiPropertyOptional({
    format: 'uri',
    example: 'https://cdn.example.com/a.png',
  })
  @IsOptional()
  @IsUrl({}, { message: 'picture must be a valid URL' })
  picture?: string;

  @ApiPropertyOptional({ example: '12 Gulshan Ave, Dhaka' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: '1990123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nidNumber?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/nid-front.png'],
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true, message: 'each nidImage must be a valid URL' })
  nidImage?: string[];
}
