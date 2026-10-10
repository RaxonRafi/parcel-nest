import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimString } from '../../common/utils/trim.transform';

export class LoginDto {
  @ApiProperty({ format: 'email', example: 'admin@parcel.com' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(trimString)
  email!: string;

  @ApiProperty({ format: 'password', example: 'Admin@123' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}
