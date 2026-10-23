import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditRecorderModule } from '../audit/audit-recorder.module';
import { AccessControlModule } from '../common/access-control.module';
import { LedgerController } from './controllers/ledger.controller';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerService } from './services/ledger.service';

/**
 * Money owed between the company, its couriers and its merchants. Depends on
 * nothing parcel-shaped beyond the entity, so `ParcelModule` and
 * `PaymentModule` can both import it without a cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([LedgerEntry]),
    AccessControlModule,
    AuditRecorderModule,
  ],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
