import { ApiProperty } from '@nestjs/swagger';
import { IsHexadecimal, IsString, Length } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../common/constants/validation.constants';
import {
  IsNewPassword,
  PASSWORD_RULES,
} from '../../common/validators/password.validator';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'The token from the emailed reset link.',
    example: 'a3f1...64 hex characters...9c2e',
  })
  @IsString()
  @IsHexadecimal({ message: 'token is not a valid reset token' })
  @Length(64, 64, { message: 'token is not a valid reset token' })
  token!: string;

  @ApiProperty({
    format: 'password',
    minLength: PASSWORD_MIN_LENGTH,
    description: `Must be ${PASSWORD_RULES}.`,
  })
  @IsNewPassword()
  newPassword!: string;
}
