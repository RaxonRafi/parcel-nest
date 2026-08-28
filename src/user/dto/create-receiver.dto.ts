import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Placeholder account created for a parcel receiver who has not registered yet.
 * Used by `ParcelService` so it never has to touch the user repository.
 */
export class CreateReceiverDto {
  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ format: 'email', example: 'jane@example.com' })
  email!: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  phone?: string;
}
