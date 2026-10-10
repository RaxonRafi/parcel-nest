import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '../../user/dto/user-response.dto';

export class AuthResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty({ description: 'Paste this into the Authorize dialog.' })
  accessToken!: string;

  @ApiPropertyOptional({
    description:
      'Also set as the `httpOnly` cookie `refresh_token`. Absent from the body when the server runs with `REFRESH_TOKEN_IN_BODY=false`.',
  })
  refreshToken?: string;
}

export class TokenPairResponseDto {
  @ApiProperty({ description: 'Paste this into the Authorize dialog.' })
  accessToken!: string;

  @ApiPropertyOptional({
    description:
      'Replaces the token you sent — the old one is revoked. Store it. Also set as the `refresh_token` cookie; absent here when the server runs with `REFRESH_TOKEN_IN_BODY=false`.',
  })
  refreshToken?: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Password changed successfully' })
  message!: string;
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, example: 'Mozilla/5.0 (Windows NT 10.0…)' })
  userAgent!: string | null;

  @ApiProperty({ nullable: true, example: '203.0.113.7' })
  ip!: string | null;

  @ApiProperty({ format: 'date-time', description: 'When this device signed in or last refreshed.' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty({
    description:
      'The session this request belongs to. Only known when the `refresh_token` cookie is sent.',
  })
  current!: boolean;
}
