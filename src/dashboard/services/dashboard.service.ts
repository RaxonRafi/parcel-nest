import { Injectable } from '@nestjs/common';
import { ParcelService } from '../../parcel/services/parcel.service';
import { UserService } from '../../user/services/user.service';
import { DashboardStats, DashboardTrends } from '../types/dashboard.types';

/**
 * Pure composition layer — it owns no entity and reads everything through the
 * services that do.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly userService: UserService,
    private readonly parcelService: ParcelService,
  ) {}

  async getStats(): Promise<DashboardStats> {
    const [userStats, parcelStats] = await Promise.all([
      this.userService.getStats(),
      this.parcelService.getStats(),
    ]);

    return { ...userStats, ...parcelStats };
  }

  /** Everything the counts cannot tell you: direction, timing, throughput. */
  async getTrends(days: number): Promise<DashboardTrends> {
    return this.parcelService.getTrends(days);
  }
}
