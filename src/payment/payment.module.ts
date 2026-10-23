import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditRecorderModule } from '../audit/audit-recorder.module';
import { AccessControlModule } from '../common/access-control.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ParcelModule } from '../parcel/parcel.module';
import { PaymentController } from './controllers/payment.controller';
import { Payment } from './entities/payment.entity';
import { SslCommerzGateway } from './gateways/sslcommerz.gateway';
import { PaymentService } from './services/payment.service';

/**
 * Online payment of delivery fees. Sits above `ParcelModule` and
 * `LedgerModule` and is imported by neither, so there is no cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    AccessControlModule,
    AuditRecorderModule,
    LedgerModule,
    ParcelModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, SslCommerzGateway],
})
export class PaymentModule {}
