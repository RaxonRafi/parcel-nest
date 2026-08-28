import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ format: 'email', example: 'admin@parcel.com' })
  email!: string;

  @ApiProperty({ format: 'password', example: 'Admin@123' })
  password!: string;
}
