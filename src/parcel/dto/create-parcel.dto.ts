import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One of `receiverId` / `receiverEmail` must be present. */
export class CreateParcelDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Existing receiver account. Omit it to have the receiver looked up (or created) by `receiverEmail`.',
  })
  receiverId?: string;

  @ApiProperty({ example: 'Jane Doe' })
  receiverName!: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  receiverPhone?: string;

  @ApiPropertyOptional({
    format: 'email',
    example: 'jane@example.com',
    description: 'Required when `receiverId` is not supplied.',
  })
  receiverEmail?: string;

  @ApiProperty({ example: '12 Gulshan Ave, Dhaka' })
  pickupAddress!: string;

  @ApiProperty({ example: '45 Agrabad, Chattogram' })
  deliveryAddress!: string;

  @ApiPropertyOptional({ example: 'Fragile — handle with care' })
  description?: string;
}
