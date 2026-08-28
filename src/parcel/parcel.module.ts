import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../common/access-control.module';
import { RagModule } from '../rag/rag.module';
import { ParcelController } from './controllers/parcel.controller';
import { ParcelStatusLog } from './entities/parcel-status-log.entity';
import { Parcel } from './entities/parcel.entity';
import { ParcelService } from './services/parcel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Parcel, ParcelStatusLog]),
    AccessControlModule,
    // Parcel writes re-index through RagService directly; RagModule does not
    // depend on ParcelModule, so this import introduces no cycle.
    RagModule,
  ],
  controllers: [ParcelController],
  providers: [ParcelService],
  exports: [ParcelService],
})
export class ParcelModule {}
