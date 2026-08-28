import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { IndexParcelDto } from './index-parcel.dto';

export class IndexBulkDto {
  @ApiProperty({ type: [IndexParcelDto] })
  @IsArray()
  @ArrayNotEmpty({ message: 'No parcels provided' })
  // Each call embeds and upserts every parcel, so an unbounded batch is a
  // straightforward way to run up an embedding bill or time the request out.
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => IndexParcelDto)
  parcels!: IndexParcelDto[];
}
