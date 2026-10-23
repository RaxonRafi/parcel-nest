import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { trimString } from '../../common/utils/trim.transform';

export class DeliveryProofDto {
  @ApiProperty({
    type: [String],
    description: 'Uploaded photo or signature URLs captured at handover.',
    example: ['https://cdn.example.com/proof/abc.jpg'],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one proof image is required' })
  @ArrayMaxSize(5)
  @IsUrl({}, { each: true, message: 'each proof image must be a valid URL' })
  images!: string[];

  @ApiPropertyOptional({
    example: 'Neighbour at flat 4B',
    description: 'Who actually took the parcel, if not the named receiver.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimString)
  receivedBy?: string;

  @ApiPropertyOptional({ example: 'Left with building security' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'Set when cash on delivery was collected at handover.',
  })
  @IsOptional()
  @IsBoolean()
  codCollected?: boolean;

  @ApiPropertyOptional({
    example: '482913',
    description:
      'The six-digit code the receiver was sent when the parcel went out for delivery. Checked whenever it is sent; required from couriers when the server sets REQUIRE_DELIVERY_OTP=true.',
  })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'deliveryCode must be six digits' })
  deliveryCode?: string;
}
