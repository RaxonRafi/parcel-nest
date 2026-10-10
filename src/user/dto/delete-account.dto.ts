import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({
    format: 'password',
    description:
      'Your current password. A stolen access token alone must not be enough to delete an account.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}
