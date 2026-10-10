import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IsActive, Role } from '../types/user.types';
import { trimString } from '../../common/utils/trim.transform';

export class QueryUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: IsActive })
  @IsOptional()
  @IsEnum(IsActive)
  isActive?: IsActive;

  @ApiPropertyOptional({
    description: 'Case-insensitive partial match on name or email.',
    example: 'jane',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimString)
  search?: string;
}
