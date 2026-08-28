import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/dto/paginated-response.dto';
import { AuditAction, AuditTargetType } from '../types/audit.types';

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null once the acting account has been deleted.',
  })
  actorEmail!: string | null;

  @ApiProperty({ enum: AuditAction })
  action!: AuditAction;

  @ApiProperty({ enum: AuditTargetType })
  targetType!: AuditTargetType;

  @ApiProperty({ example: 'TRK-20260828-A1B2C3' })
  targetId!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Blocked jane@example.com' })
  summary!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Before/after values for the change.',
    example: { from: 'ACTIVE', to: 'BLOCKED' },
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class PaginatedAuditDto {
  @ApiProperty({ type: [AuditLogResponseDto] })
  data!: AuditLogResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
