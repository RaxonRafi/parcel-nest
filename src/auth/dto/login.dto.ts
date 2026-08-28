import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ format: 'email', example: 'admin@parcel.com' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;

  @ApiProperty({ format: 'password', example: 'Admin@123' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}
