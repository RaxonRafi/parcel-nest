import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Sender' })
  name?: string;

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
