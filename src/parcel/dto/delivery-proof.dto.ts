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
  MaxLength,
} from 'class-validator';

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
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
}
