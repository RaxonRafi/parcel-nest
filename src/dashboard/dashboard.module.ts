import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { Parcel } from '../parcel/parcel.entity';
import { User } from '../user/user.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Parcel]), AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService, RolesGuard],
})
export class DashboardModule {}
