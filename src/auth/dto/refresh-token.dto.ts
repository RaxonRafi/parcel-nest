import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsJWT, IsOptional } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description:
      'Refresh token issued alongside the access token at login. Optional when the `refresh_token` cookie is sent instead.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsJWT({ message: 'refreshToken must be a valid JWT' })
  refreshToken?: string;
}
