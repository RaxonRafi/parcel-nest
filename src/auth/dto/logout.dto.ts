import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsJWT, IsOptional } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Refresh token for the session to end. When omitted, the `refresh_token` cookie is used; with neither, every device is signed out.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsJWT({ message: 'refreshToken must be a valid JWT' })
  refreshToken?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Sign out of every device. Needed by a client that relies on the cookie, where leaving the token out no longer means "everywhere".',
  })
  @IsOptional()
  @IsBoolean()
  everywhere?: boolean;
}
