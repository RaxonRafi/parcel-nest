import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Parcel } from '../parcel/parcel.entity';
import { ParcelStatus } from '../parcel/parcel.interface';
import { User } from '../user/user.entity';
import { IsActive } from '../user/user.interface';

export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  blockedUsers: number;
  totalParcels: number;
  parcelsByStatus: Record<string, number>;
  blockedParcels: number;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Parcel)
    private readonly parcelRepository: Repository<Parcel>,
  ) {}

  async getStats(): Promise<DashboardStats> {
    const totalUsers = await this.userRepository.count({
      where: { isDeleted: false },
    });

    const activeUsers = await this.userRepository.count({
      where: { isDeleted: false, isActive: IsActive.ACTIVE },
    });

    const blockedUsers = await this.userRepository.count({
      where: { isDeleted: false, isActive: IsActive.BLOCKED },
    });

    const totalParcels = await this.parcelRepository.count();
    const blockedParcels = await this.parcelRepository.count({
      where: { isBlocked: true },
    });

    const statusRows = await this.parcelRepository
      .createQueryBuilder('parcel')
      .select('parcel.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('parcel.status')
      .getRawMany<{ status: string; count: string }>();

    const parcelsByStatus = Object.values(ParcelStatus).reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<string, number>,
    );

    for (const row of statusRows) {
      parcelsByStatus[row.status] = Number(row.count);
    }

    return {
      totalUsers,
      activeUsers,
      blockedUsers,
      totalParcels,
      parcelsByStatus,
      blockedParcels,
    };
  }
}
