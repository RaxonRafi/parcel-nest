import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { PHONE_REGEX } from '../../common/constants/validation.constants';
import { trimString } from '../../common/utils/trim.transform';
import { Role } from '../types/user.types';

/**
 * What an admin may change on someone else's account. Email and password are
 * deliberately absent: an address change has to be proved by its owner, and a
 * password is reset by its owner through the emailed link.
 */
export class AdminUpdateUserDto {
  @ApiPropertyOptional({ example: 'John Sender' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(trimString)
  name?: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone?: string;

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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true, message: 'each nidImage must be a valid URL' })
  nidImage?: string[];

  @ApiPropertyOptional({
    enum: Role,
    description:
      'An admin cannot change their own role, and the super admin always stays an admin.',
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({
    description: 'Mark the address confirmed without the emailed link.',
  })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
