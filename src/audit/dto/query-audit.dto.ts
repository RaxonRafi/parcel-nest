import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditAction, AuditTargetType } from '../types/audit.types';

export class QueryAuditDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditTargetType })
  @IsOptional()
  @IsEnum(AuditTargetType)
  targetType?: AuditTargetType;

  @ApiPropertyOptional({
    description: 'User uuid or parcel tracking id.',
    example: 'TRK-20260828-A1B2C3',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;
}
