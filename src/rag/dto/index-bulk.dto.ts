import { ApiProperty } from '@nestjs/swagger';
import { IndexParcelDto } from './index-parcel.dto';

export class IndexBulkDto {
  @ApiProperty({ type: [IndexParcelDto] })
  parcels!: IndexParcelDto[];
}
