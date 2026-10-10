import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { trimString } from '../../common/utils/trim.transform';

export class ForgotPasswordDto {
  @ApiProperty({ format: 'email', example: 'john@example.com' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(trimString)
  email!: string;
}
