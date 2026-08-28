import { Module } from '@nestjs/common';
import { AccessControlModule } from '../common/access-control.module';
import { ParcelModule } from '../parcel/parcel.module';
import { DashboardController } from './controllers/dashboard.controller';
import { DashboardService } from './services/dashboard.service';

@Module({
  imports: [AccessControlModule, ParcelModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
