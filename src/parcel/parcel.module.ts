import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../common/access-control.module';
import { ParcelController } from './controllers/parcel.controller';
import { ParcelStatusLog } from './entities/parcel-status-log.entity';
import { Parcel } from './entities/parcel.entity';
import { ParcelService } from './services/parcel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Parcel, ParcelStatusLog]),
    AccessControlModule,
  ],
  controllers: [ParcelController],
  providers: [ParcelService],
  exports: [ParcelService],
})
export class ParcelModule {}
