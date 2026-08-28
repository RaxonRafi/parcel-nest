import { ApiProperty } from '@nestjs/swagger';
import { IsHexadecimal, IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'The token from the confirmation link.' })
  @IsString()
  @IsHexadecimal({ message: 'token is not a valid confirmation token' })
  @Length(64, 64, { message: 'token is not a valid confirmation token' })
  token!: string;
}
