import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PHONE_REGEX,
} from '../../common/constants/validation.constants';
import { Role } from '../types/user.types';

export class CreateUserDto {
  @ApiProperty({ example: 'John Sender' })
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({ format: 'email', example: 'john@example.com' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;

  @ApiProperty({
    format: 'password',
    minLength: PASSWORD_MIN_LENGTH,
    example: 'Passw0rd!',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password!: string;

  @ApiPropertyOptional({
    enum: Role,
    default: Role.SENDER,
    description:
      'Requesting `ADMIN` requires an existing admin bearer token on the request. `DELIVERY_PERSONNEL` is downgraded to `PENDING_DELIVERY` until an admin approves.',
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

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
