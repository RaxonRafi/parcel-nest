import { Injectable } from '@nestjs/common';
import { ParcelService } from '../../parcel/services/parcel.service';
import { UserService } from '../../user/services/user.service';
import { DashboardStats } from '../types/dashboard.types';

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
}
