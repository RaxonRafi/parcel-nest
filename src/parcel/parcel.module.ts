import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditRecorderModule } from '../audit/audit-recorder.module';
import { AccountTokensModule } from '../auth/account-tokens.module';
import { AccessControlModule } from '../common/access-control.module';
import { RagModule } from '../rag/rag.module';
import { ParcelController } from './controllers/parcel.controller';
import { ParcelStatusLog } from './entities/parcel-status-log.entity';
import { Parcel } from './entities/parcel.entity';
import { ParcelNotificationService } from './services/parcel-notification.service';
import { ParcelService } from './services/parcel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Parcel, ParcelStatusLog]),
    AccessControlModule,
    AccountTokensModule,
    AuditRecorderModule,
    // Parcel writes re-index through RagService directly; RagModule does not
    // depend on ParcelModule, so this import introduces no cycle.
    RagModule,
  ],
  controllers: [ParcelController],
  providers: [ParcelService, ParcelNotificationService],
  exports: [ParcelService],
})
export class ParcelModule {}
