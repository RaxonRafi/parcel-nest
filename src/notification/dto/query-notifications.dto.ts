import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only notifications not read yet.' })
  @IsOptional()
  // Query strings carry "true"/"false", which @IsBoolean would otherwise reject.
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;
}
