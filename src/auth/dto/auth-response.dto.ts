import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../user/dto/user-response.dto';

export class AuthResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty({ description: 'Paste this into the Authorize dialog.' })
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;
}

export class AccessTokenResponseDto {
  @ApiProperty()
  accessToken!: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Password changed successfully' })
  message!: string;
}
