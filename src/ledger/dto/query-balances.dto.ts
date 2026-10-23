import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryBalancesDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Only accounts whose balance is not zero.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  outstandingOnly?: boolean;
}
