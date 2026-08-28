import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ format: 'password', example: 'OldPass@123' })
  currentPassword!: string;

  @ApiProperty({ format: 'password', example: 'NewPass@456' })
  newPassword!: string;
}
