import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ format: 'email', example: 'john@example.com' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;
}
