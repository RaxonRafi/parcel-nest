import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JWT_AUTH } from '../../config/swagger.config';
import { Role } from '../../user/types/user.types';
import { DashboardStatsDto } from '../dto/dashboard-stats.dto';
import { DashboardService } from '../services/dashboard.service';
import { DashboardStats } from '../types/dashboard.types';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Aggregate user and parcel counts',
    description: 'Admin only.',
  })
  @ApiResponse({ status: 200, type: DashboardStatsDto })
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get()
  getDashboardStats(): Promise<DashboardStats> {
    return this.dashboardService.getStats();
  }
}
