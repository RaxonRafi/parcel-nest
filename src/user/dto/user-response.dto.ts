import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthProviderType, IsActive, Role } from '../types/user.types';

/** Documentation shape for `SafeUser` — the user record minus the password. */
export class AuthProviderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: AuthProviderType })
  provider!: AuthProviderType;

  @ApiProperty({ example: 'john@example.com' })
  providerId!: string;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'John Sender' })
  name!: string;

  @ApiProperty({ format: 'email', example: 'john@example.com' })
  email!: string;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiPropertyOptional({ example: '+8801700000000' })
  phone?: string;

  @ApiPropertyOptional({ format: 'uri' })
  picture?: string;

  @ApiPropertyOptional({ example: '12 Gulshan Ave, Dhaka' })
  address?: string;

  @ApiProperty({ default: false })
  isDeleted!: boolean;

  @ApiProperty({ enum: IsActive })
  isActive!: IsActive;

  @ApiProperty({ default: false })
  isVerified!: boolean;

  @ApiPropertyOptional({ example: '1990123456789' })
  nidNumber?: string;

  @ApiProperty({ type: [String] })
  nidImage!: string[];

  @ApiPropertyOptional({ type: [AuthProviderResponseDto] })
  auths?: AuthProviderResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
