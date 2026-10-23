import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction, AuditTargetType } from '../../audit/types/audit.types';
import { webBaseUrl } from '../../common/utils/web-url.util';
import { GLOBAL_PREFIX } from '../../config/app.config';
import { LedgerService } from '../../ledger/services/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryType,
} from '../../ledger/types/ledger.types';
import { ParcelService } from '../../parcel/services/parcel.service';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../user/types/user.types';
import { Payment } from '../entities/payment.entity';
import {
  GatewayError,
  SslCommerzGateway,
  ValidationResult,
} from '../gateways/sslcommerz.gateway';
import {
  CheckoutSession,
  PaymentOutcome,
  PaymentProvider,
  PaymentState,
} from '../types/payment.types';

/** A payment is believed only when validation says one of these. */
const VALID_STATUSES = ['VALID', 'VALIDATED'];

/** Fields a gateway callback is read for. Everything else is ignored. */
export interface GatewayCallback {
  tran_id?: string;
  val_id?: string;
  error?: string;
}

/**
 * Online payment of a prepaid parcel's delivery fee.
 *
 * The browser-facing callbacks and the gateway's server-to-server IPN all
 * funnel into `confirm`, which re-validates with the gateway and is
 * idempotent: whichever arrives first credits the fee, the other finds the
 * payment already settled.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly parcelService: ParcelService,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
    private readonly gateway: SslCommerzGateway,
    private readonly config: ConfigService,
  ) {}

  async checkout(trackingId: string, payer: User): Promise<CheckoutSession> {
    if (!this.gateway.isEnabled()) {
      throw new ServiceUnavailableException(
        'Online payment is not configured on this server',
      );
    }

    const parcel = await this.parcelService.findPayableParcel(trackingId, payer);

    const payment = await this.paymentRepository.save(
      this.paymentRepository.create({
        parcel: { id: parcel.id },
        payer: { id: payer.id },
        provider: PaymentProvider.SSLCOMMERZ,
        tranId: `${parcel.trackingId}-${randomBytes(4).toString('hex').toUpperCase()}`,
        amount: parcel.deliveryFee,
        currency: 'BDT',
      }),
    );

    const callback = (path: string) =>
      `${this.apiBaseUrl()}/${GLOBAL_PREFIX}/payments/sslcommerz/${path}`;

    let gatewayUrl: string;
    try {
      gatewayUrl = await this.gateway.createSession({
        tranId: payment.tranId,
        amount: payment.amount,
        currency: payment.currency,
        successUrl: callback('success'),
        failUrl: callback('fail'),
        cancelUrl: callback('cancel'),
        ipnUrl: callback('ipn'),
        customer: {
          name: payer.name,
          email: payer.email,
          phone: payer.phone || parcel.senderPhone || '01700000000',
          address: parcel.pickupAddress,
        },
        productName: `Delivery fee ${parcel.trackingId}`,
        reference: parcel.trackingId,
      });
    } catch (error) {
      await this.paymentRepository.update(payment.id, {
        status: PaymentState.FAILED,
        failureReason:
          error instanceof Error ? error.message : 'Gateway session failed',
      });
      if (error instanceof GatewayError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }

    return {
      paymentId: payment.id,
      tranId: payment.tranId,
      amount: payment.amount,
      currency: payment.currency,
      gatewayUrl,
    };
  }

  /** Every attempt to pay one parcel, newest first. */
  async listForParcel(trackingId: string, viewer: User): Promise<Payment[]> {
    const parcel = await this.parcelService.getDetails(trackingId, viewer);

    if (viewer.role !== Role.ADMIN && parcel.sender?.id !== viewer.id) {
      throw new ForbiddenException(
        'Only the sender or an admin can see payments',
      );
    }

    return this.paymentRepository.find({
      where: { parcel: { id: parcel.id } },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Settles a payment the gateway reports as finished. Trusts nothing in the
   * callback except which payment it is about: the outcome comes from the
   * gateway's validation API, and must agree with what was asked for.
   */
  async confirm(
    callback: GatewayCallback,
  ): Promise<{ outcome: PaymentOutcome; trackingId: string | null }> {
    const payment = await this.findByTranId(callback.tran_id);
    if (!payment) {
      return { outcome: 'failed', trackingId: null };
    }
    const trackingId = payment.parcel.trackingId;

    if (payment.status === PaymentState.PAID) {
      return { outcome: 'paid', trackingId };
    }
    if (!callback.val_id) {
      await this.settleUnpaid(payment, PaymentState.FAILED, 'No validation id');
      return { outcome: 'failed', trackingId };
    }

    let validation: ValidationResult;
    try {
      validation = await this.gateway.validate(callback.val_id);
    } catch (error) {
      // Leave it INITIATED: the IPN, or the sender retrying, will confirm it
      // once the gateway answers again.
      this.logger.warn(
        `Could not validate ${payment.tranId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { outcome: 'failed', trackingId };
    }

    const problem = this.mismatch(payment, validation);
    if (problem) {
      this.logger.warn(`Payment ${payment.tranId} refused: ${problem}`);
      await this.settleUnpaid(payment, PaymentState.FAILED, problem);
      return { outcome: 'failed', trackingId };
    }

    if (validation.risk_level === '1') {
      await this.settleUnpaid(
        payment,
        PaymentState.REVIEW,
        validation.risk_title || 'Flagged by the gateway for review',
      );
      return { outcome: 'review', trackingId };
    }

    const credited = await this.paymentRepository.manager.transaction(
      async (manager) => {
        // Conditional, so a success callback and the IPN racing each other
        // credit the fee once between them.
        const result = await manager.update(
          Payment,
          { id: payment.id, status: In([PaymentState.INITIATED, PaymentState.FAILED, PaymentState.CANCELLED]) },
          {
            status: PaymentState.PAID,
            valId: validation.val_id ?? callback.val_id,
            bankTranId: validation.bank_tran_id ?? null,
            cardType: validation.card_type ?? null,
            failureReason: null,
            paidAt: new Date(),
          },
        );
        if (!result.affected) return false;

        await this.ledgerService.post(manager, [
          {
            accountType: LedgerAccountType.MERCHANT,
            accountId: payment.parcel.sender.id,
            type: LedgerEntryType.FEE_PAYMENT,
            amount: payment.amount,
            parcelId: payment.parcel.id,
            trackingId,
            reference: payment.tranId,
            note: validation.card_type ?? null,
            createdById: payment.payer?.id ?? null,
          },
        ]);

        // The fee may have been re-priced while the sender sat on the
        // gateway page; the money is credited either way, but the parcel
        // only counts as paid when it covers the current fee.
        if (payment.amount >= payment.parcel.deliveryFee) {
          await this.parcelService.markFeePaid(manager, payment.parcel.id);
        }
        return true;
      },
    );

    if (credited) {
      await this.auditService.record({
        actor: payment.payer as User,
        action: AuditAction.PAYMENT_RECEIVED,
        targetType: AuditTargetType.PARCEL,
        targetId: trackingId,
        summary: `Paid ${payment.amount} ${payment.currency} online`,
        metadata: {
          tranId: payment.tranId,
          amount: payment.amount,
          cardType: validation.card_type ?? null,
        },
      });
    }

    return { outcome: 'paid', trackingId };
  }

  /** The sender gave up, or the gateway declined. Never undoes a payment. */
  async abandon(
    callback: GatewayCallback,
    state: PaymentState.FAILED | PaymentState.CANCELLED,
  ): Promise<{ outcome: PaymentOutcome; trackingId: string | null }> {
    const payment = await this.findByTranId(callback.tran_id);
    if (!payment) {
      return { outcome: 'failed', trackingId: null };
    }

    if (payment.status === PaymentState.PAID) {
      return { outcome: 'paid', trackingId: payment.parcel.trackingId };
    }

    await this.settleUnpaid(
      payment,
      state,
      callback.error ?? (state === PaymentState.CANCELLED ? 'Cancelled by the payer' : 'Declined'),
    );
    return {
      outcome: state === PaymentState.CANCELLED ? 'cancelled' : 'failed',
      trackingId: payment.parcel.trackingId,
    };
  }

  /** Where the sender's browser lands after the gateway. */
  resultUrl(outcome: PaymentOutcome, trackingId: string | null): string {
    const query = new URLSearchParams({ status: outcome });
    if (trackingId) query.set('trackingId', trackingId);
    return `${webBaseUrl(this.config)}/payments/result?${query.toString()}`;
  }

  private async findByTranId(tranId?: string): Promise<Payment | null> {
    if (!tranId) return null;

    const payment = await this.paymentRepository.findOne({
      where: { tranId },
      relations: ['parcel', 'parcel.sender', 'payer'],
    });
    if (!payment) {
      this.logger.warn(`Callback for unknown transaction ${tranId}`);
    }
    return payment;
  }

  private mismatch(
    payment: Payment,
    validation: ValidationResult,
  ): string | null {
    if (!VALID_STATUSES.includes(validation.status)) {
      return `gateway status ${validation.status}`;
    }
    if (validation.tran_id !== payment.tranId) {
      return `transaction ${validation.tran_id} is not ${payment.tranId}`;
    }
    if (validation.currency && validation.currency !== payment.currency) {
      return `currency ${validation.currency}, expected ${payment.currency}`;
    }
    if (Math.abs(Number(validation.amount) - payment.amount) >= 0.01) {
      return `amount ${validation.amount}, expected ${payment.amount}`;
    }
    return null;
  }

  /** Records a non-payment, without ever overwriting one that succeeded. */
  private async settleUnpaid(
    payment: Payment,
    state: PaymentState,
    reason: string,
  ): Promise<void> {
    await this.paymentRepository.update(
      { id: payment.id, status: In([PaymentState.INITIATED, PaymentState.FAILED, PaymentState.CANCELLED]) },
      { status: state, failureReason: reason },
    );
  }

  /** This API's own public address, for the gateway to call back on. */
  private apiBaseUrl(): string {
    const configured = this.config.get<string>('APP_URL');
    if (configured) return configured.replace(/\/+$/, '');

    // Vercel names the production domain in every deployment. Without this a
    // deploy missing APP_URL told the gateway to call back on localhost,
    // which the payer's browser then tried to reach.
    const vercelHost = this.config.get<string>('VERCEL_PROJECT_PRODUCTION_URL');
    if (vercelHost) return `https://${vercelHost.replace(/\/+$/, '')}`;

    const port = this.config.get<string>('PORT') ?? '5000';
    return `http://localhost:${port}`;
  }
}
