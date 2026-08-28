import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryTrendsDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 365,
    default: 30,
    description: 'How many days back the trend window reaches.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}
