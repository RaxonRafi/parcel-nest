import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../types/user.types';

export class CreateUserDto {
  @ApiProperty({ example: 'John Sender' })
  name!: string;

  @ApiProperty({ format: 'email', example: 'john@example.com' })
  email!: string;

  @ApiProperty({ format: 'password', minLength: 6, example: 'Passw0rd!' })
  password!: string;

  @ApiPropertyOptional({
    enum: Role,
    default: Role.SENDER,
    description:
      'Requesting `ADMIN` requires an existing admin bearer token on the request.',
  })
  role?: Role;

  @ApiPropertyOptional({ example: '+8801700000000' })
  phone?: string;

  @ApiPropertyOptional({
    format: 'uri',
    example: 'https://cdn.example.com/a.png',
  })
  picture?: string;

  @ApiPropertyOptional({ example: '12 Gulshan Ave, Dhaka' })
  address?: string;

  @ApiPropertyOptional({ example: '1990123456789' })
  nidNumber?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/nid-front.png'],
  })
  nidImage?: string[];
}
