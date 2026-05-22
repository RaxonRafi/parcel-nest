import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { User } from '../user/user.entity';
import { ParcelStatusLog } from './parcel-status-log.entity';
import { Parcel } from './parcel.entity';
import { ParcelController } from './parcel.controller';
import { ParcelService } from './parcel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Parcel, ParcelStatusLog, User]),
    AuthModule,
  ],
  controllers: [ParcelController],
  providers: [ParcelService, RolesGuard],
  exports: [ParcelService],
})
export class ParcelModule {}
