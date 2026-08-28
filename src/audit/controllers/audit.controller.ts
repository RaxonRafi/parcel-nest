import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Paginated } from '../../common/types/paginated.type';
import { JWT_AUTH } from '../../config/swagger.config';
import { Role } from '../../user/types/user.types';
import { PaginatedAuditDto } from '../dto/audit-response.dto';
import { QueryAuditDto } from '../dto/query-audit.dto';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditService } from '../services/audit.service';

@ApiTags('Audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Browse the admin audit trail',
    description:
      'Admin only. Newest first. Filterable by action, target type and target id.',
  })
  @ApiResponse({ status: 200, type: PaginatedAuditDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get()
  find(@Query() query: QueryAuditDto): Promise<Paginated<AuditLog>> {
    return this.auditService.find(query);
  }

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'History for one user or parcel',
    description: 'Admin only. Pass a user uuid or a parcel tracking id.',
  })
  @ApiParam({ name: 'targetId', example: 'TRK-20260828-A1B2C3' })
  @ApiResponse({ status: 200, type: PaginatedAuditDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('target/:targetId')
  findForTarget(
    @Param('targetId') targetId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<AuditLog>> {
    return this.auditService.findForTarget(targetId, query);
  }
}
