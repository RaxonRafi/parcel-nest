import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import {
  Between,
  FindOperator,
  ILike,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { BackgroundService } from '../../common/background/background.service';
import { Paginated, paginate } from '../../common/types/paginated.type';
import { escapeLike } from '../../common/utils/like.util';
import {
  CourierThroughput,
  DailyCount,
  DashboardTrends,
  RevenueSummary,
  StatusTiming,
} from '../../dashboard/types/dashboard.types';
import { firstName } from '../../common/utils/name.util';
import { User } from '../../user/entities/user.entity';
import { RagService } from '../../rag/services/rag.service';
import { UserService } from '../../user/services/user.service';
import { Role } from '../../user/types/user.types';
import { EntityManager } from 'typeorm';
import { LedgerService } from '../../ledger/services/ledger.service';
import { LedgerDraft } from '../../ledger/types/ledger.types';
import {
  bookingEntries,
  cancellationEntries,
  deliveryEntries,
  repricingEntries,
  returnEntries,
} from '../../ledger/utils/ledger.util';
import { CreateParcelDto } from '../dto/create-parcel.dto';
import { FailedAttemptDto, RescheduleDeliveryDto } from '../dto/delivery-attempt.dto';
import { DeliveryProofDto } from '../dto/delivery-proof.dto';
import { QueryParcelsDto } from '../dto/query-parcels.dto';
import { QuoteParcelDto } from '../dto/quote-parcel.dto';
import { UpdateParcelDto } from '../dto/update-parcel.dto';
import { UpdateParcelStatusDto } from '../dto/update-parcel-status.dto';
import { ParcelStatusLog } from '../entities/parcel-status-log.entity';
import { Parcel } from '../entities/parcel.entity';
import {
  calculateDeliveryFee,
  calculateReturnFee,
  estimateDeliveryAt,
  expressAvailable,
  FeeBreakdown,
  PricingRates,
  ratesFromEnv,
  routeFor,
} from '../utils/pricing.util';
import {
  deliveryCodeMatches,
  generateDeliveryCode,
  hashDeliveryCode,
  MAX_DELIVERY_CODE_ATTEMPTS,
} from '../utils/delivery-code.util';
import { BulkRow } from '../utils/parcel-csv.util';
import { renderInvoice, renderLabel } from '../utils/parcel-documents.util';
import { toPublicParcel } from '../utils/public-parcel.util';
import { webBaseUrl } from '../../common/utils/web-url.util';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction, AuditTargetType } from '../../audit/types/audit.types';
import { PasswordResetService } from '../../auth/services/password-reset.service';
import { ParcelNotificationService } from './parcel-notification.service';
import { sanitizeParcel, sanitizeParcels } from '../utils/sanitize-parcel.util';
import {
  CLOSED_STATUSES,
  DeliveryFailureReason,
  PARCEL_STATUS_TRANSITIONS,
  ParcelIndexDocument,
  ParcelStats,
  ParcelStatus,
  PaymentStatus,
  PublicParcel,
  ServiceTier,
} from '../types/parcel.types';

const PARCEL_RELATIONS = [
  'sender',
  'receiver',
  'deliveryPersonnel',
  'statusLogs',
  'statusLogs.changedBy',
];

/**
 * Lists leave the timeline out. Loading `statusLogs` and each entry's author
 * cost two extra joins and multiplied the rows by the length of every
 * parcel's history, for data a list row does not show; the detail route
 * loads it for the one parcel being looked at.
 */
const LIST_RELATIONS = ['sender', 'receiver', 'deliveryPersonnel'];

/**
 * Statuses a courier may set on a parcel assigned to them. Cancelling stays
 * with the sender and blocking stays with an admin, so neither appears here.
 * FAILED_ATTEMPT is a courier's to record too, but through its own route,
 * because it needs a reason.
 */
const COURIER_STATUSES: ParcelStatus[] = [
  ParcelStatus.PICKED_UP,
  ParcelStatus.IN_TRANSIT,
  ParcelStatus.OUT_FOR_DELIVERY,
  ParcelStatus.DELIVERED,
  ParcelStatus.RETURNING,
  ParcelStatus.RETURNED_TO_SENDER,
];

/** Attempts before a parcel must go back, unless MAX_DELIVERY_ATTEMPTS says otherwise. */
const DEFAULT_MAX_DELIVERY_ATTEMPTS = 3;

/** How far ahead a pickup slot or a reschedule may be booked. */
const BOOKING_HORIZON_MS = 14 * 86_400_000;

/** Longest pickup slot a sender may ask for. */
const MAX_PICKUP_WINDOW_MS = 12 * 3_600_000;

/**
 * Leeway for a slot or reschedule that starts "now": a client clock a few
 * minutes behind should not see its booking refused.
 */
const CLOCK_SKEW_MS = 5 * 60_000;

const FAILURE_LABELS: Record<DeliveryFailureReason, string> = {
  [DeliveryFailureReason.RECEIVER_UNAVAILABLE]: 'receiver unavailable',
  [DeliveryFailureReason.RECEIVER_UNREACHABLE]: 'receiver unreachable by phone',
  [DeliveryFailureReason.WRONG_ADDRESS]: 'address could not be found',
  [DeliveryFailureReason.REFUSED]: 'receiver refused the parcel',
  [DeliveryFailureReason.RESCHEDULE_REQUESTED]: 'receiver asked for another day',
  [DeliveryFailureReason.OTHER]: 'could not be delivered',
};

/** What `updateParcel` will change, and the fields that move the price. */
const PRICED_FIELDS = [
  'weightKg',
  'codAmount',
  'pickupZone',
  'deliveryZone',
  'serviceTier',
] as const;

/** Builds the right TypeORM operator for whichever bounds were supplied. */
function dateRange(from?: string, to?: string): FindOperator<Date> | undefined {
  if (from && to) return Between(new Date(from), new Date(to));
  if (from) return MoreThanOrEqual(new Date(from));
  if (to) return LessThanOrEqual(new Date(to));
  return undefined;
}

/** Parcels embedded per call when the assistant's index is rebuilt. */
const REINDEX_PAGE_SIZE = 50;

/**
 * Sole owner of the `parcels` / `parcel_status_logs` tables. User lookups are
 * delegated to `UserService` rather than injecting the user repository here.
 */
@Injectable()
export class ParcelService {
  private readonly logger = new Logger(ParcelService.name);

  constructor(
    @InjectRepository(Parcel)
    private readonly parcelRepository: Repository<Parcel>,
    private readonly userService: UserService,
    private readonly ragService: RagService,
    private readonly notifications: ParcelNotificationService,
    private readonly config: ConfigService,
    private readonly passwordResetService: PasswordResetService,
    private readonly auditService: AuditService,
    private readonly background: BackgroundService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * What a parcel would cost to send. Public, and the same calculation
   * booking uses, so a quote is never a different number from the bill.
   */
  quote(payload: QuoteParcelDto): FeeBreakdown {
    const route = routeFor(payload.pickupZone, payload.deliveryZone);

    if (
      payload.serviceTier === ServiceTier.EXPRESS &&
      !expressAvailable(route)
    ) {
      throw new BadRequestException(
        'Express delivery is only offered inside Dhaka and its suburbs',
      );
    }

    return calculateDeliveryFee(
      payload.weightKg ?? 1,
      payload.codAmount ?? 0,
      this.rates(),
      payload,
    );
  }

  async create(sender: User, payload: CreateParcelDto): Promise<Parcel> {
    if (sender.role !== Role.SENDER && sender.role !== Role.ADMIN) {
      throw new ForbiddenException('Only senders can create parcels');
    }

    this.userService.assertEmailVerified(sender, 'booking a parcel');

    const pickupWindow = this.parsePickupWindow(
      payload.pickupWindowStart,
      payload.pickupWindowEnd,
    );

    const { user: receiver, created: receiverIsNew } =
      await this.resolveReceiver(payload);

    if (receiver.id === sender.id) {
      throw new BadRequestException('You cannot send a parcel to yourself');
    }

    const weightKg = payload.weightKg ?? 1;
    const codAmount = payload.codAmount ?? 0;
    // Priced here, never taken from the request.
    const feeBreakdown = this.quote({ ...payload, weightKg, codAmount });

    const parcel = this.parcelRepository.create({
      trackingId: await this.generateTrackingId(),
      sender,
      receiver,
      senderName: sender.name,
      receiverName: payload.receiverName,
      senderPhone: sender.phone,
      receiverPhone: payload.receiverPhone,
      pickupAddress: payload.pickupAddress,
      deliveryAddress: payload.deliveryAddress,
      description: payload.description,
      weightKg,
      codAmount,
      deliveryFee: feeBreakdown.total,
      feeBreakdown,
      paymentStatus: codAmount > 0 ? PaymentStatus.NOT_REQUIRED : PaymentStatus.UNPAID,
      pickupZone: payload.pickupZone,
      deliveryZone: payload.deliveryZone,
      serviceTier: payload.serviceTier,
      pickupWindowStart: pickupWindow?.start ?? null,
      pickupWindowEnd: pickupWindow?.end ?? null,
      estimatedDeliveryAt: estimateDeliveryAt(
        pickupWindow?.end ?? new Date(),
        feeBreakdown.route!,
        feeBreakdown.serviceTier,
      ),
      status: ParcelStatus.PENDING,
      statusLogs: [
        {
          status: ParcelStatus.PENDING,
          note: 'Parcel created',
          changedBy: sender,
        },
      ],
    });

    // The fee is charged in the same commit that books the parcel, so a
    // parcel can never exist without its charge or the other way round.
    const savedParcel = await this.parcelRepository.manager.transaction(
      async (manager) => {
        const saved = await manager.save(parcel);
        await this.ledgerService.post(manager, bookingEntries(saved));
        return saved;
      },
    );
    await this.auditService.record({
      actor: sender,
      action: AuditAction.PARCEL_CREATED,
      targetType: AuditTargetType.PARCEL,
      targetId: savedParcel.trackingId,
      summary: `Booked for ${receiver.email}`,
      metadata: {
        receiverId: receiver.id,
        weightKg,
        codAmount,
        deliveryFee: feeBreakdown.total,
        route: feeBreakdown.route,
        serviceTier: feeBreakdown.serviceTier,
      },
    });

    // PENDING sends no email; the notification only reaches dashboards.
    const freshParcel = await this.announce(savedParcel.trackingId);

    if (receiverIsNew) {
      // The account was created for them; they have no password yet.
      await this.passwordResetService.issueClaim(
        receiver,
        sender.name,
        freshParcel.trackingId,
      );
    }

    return freshParcel;
  }

  /**
   * Admins may set any status. Couriers may only move parcels assigned to
   * them, and only through the delivery statuses in `COURIER_STATUSES`.
   */
  async updateStatus(
    trackingId: string,
    payload: UpdateParcelStatusDto,
    actor: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.isBlocked) {
      throw new BadRequestException('Parcel is blocked');
    }

    if (actor.role === Role.DELIVERY_PERSONNEL) {
      this.assertCourierMaySetStatus(parcel, payload.status, actor);
    }

    // A failed attempt carries a reason and counts against the limit, so it
    // has its own route rather than being a bare status here.
    if (payload.status === ParcelStatus.FAILED_ATTEMPT) {
      throw new BadRequestException(
        'Record a failed delivery through PATCH /parcels/:trackingId/failed-attempt',
      );
    }

    this.assertTransitionAllowed(parcel.status, payload.status);

    // A parcel cannot have been collected by nobody. Without this an admin
    // could mark it picked up and leave no courier answerable for it.
    if (payload.status === ParcelStatus.PICKED_UP && !parcel.deliveryPersonnel) {
      throw new BadRequestException(
        'Assign a courier before marking this parcel as picked up',
      );
    }

    if (
      payload.status === ParcelStatus.PICKED_UP &&
      parcel.paymentStatus === PaymentStatus.UNPAID &&
      this.flag('REQUIRE_PAYMENT_BEFORE_PICKUP')
    ) {
      throw new BadRequestException(
        'The delivery fee for this prepaid parcel has not been paid yet',
      );
    }

    // The code is what proves a courier stood at the right door; with it
    // required, a courier can only close a parcel through delivery proof.
    if (
      payload.status === ParcelStatus.DELIVERED &&
      actor.role === Role.DELIVERY_PERSONNEL &&
      this.flag('REQUIRE_DELIVERY_OTP')
    ) {
      throw new BadRequestException(
        "Submit delivery proof with the receiver's delivery code to mark this parcel delivered",
      );
    }

    const from = parcel.status;
    let ledger: LedgerDraft[] | ((m: EntityManager) => Promise<LedgerDraft[]>) =
      [];
    let deliveryCode: string | null = null;

    switch (payload.status) {
      case ParcelStatus.DELIVERED:
        ledger = this.markDelivered(parcel);
        break;

      case ParcelStatus.OUT_FOR_DELIVERY:
        if (from === ParcelStatus.FAILED_ATTEMPT) {
          this.assertAttemptsLeft(parcel);
        }
        parcel.status = payload.status;
        // A fresh code every time the parcel heads out: one read out at a
        // door on Monday is no use on Wednesday.
        deliveryCode = this.issueDeliveryCode(parcel);
        parcel.rescheduledFor = null;
        break;

      case ParcelStatus.RETURNED_TO_SENDER:
        parcel.status = payload.status;
        parcel.returnFee = calculateReturnFee(
          parcel.feeBreakdown,
          parcel.deliveryFee,
          this.rates(),
        );
        ledger = returnEntries(parcel);
        break;

      case ParcelStatus.CANCELLED:
        parcel.status = payload.status;
        ledger = async (manager) =>
          cancellationEntries(
            parcel,
            await this.ledgerService.feeChargedFor(manager, parcel.id),
          );
        break;

      default:
        parcel.status = payload.status;
    }

    if (payload.status !== ParcelStatus.OUT_FOR_DELIVERY) {
      parcel.deliveryCodeHash = null;
    }

    await this.persist(
      parcel,
      { status: payload.status, actor, note: payload.note },
      ledger,
    );
    await this.auditService.record({
      actor,
      action: AuditAction.PARCEL_STATUS_CHANGED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: `${from} → ${payload.status}`,
      metadata: {
        from,
        to: payload.status,
        note: payload.note ?? null,
        ...(parcel.returnFee !== null && payload.status === ParcelStatus.RETURNED_TO_SENDER
          ? { returnFee: parcel.returnFee }
          : {}),
      },
    });

    const fresh = await this.announce(trackingId);
    if (deliveryCode) {
      this.sendDeliveryCode(fresh, deliveryCode);
    }
    return fresh;
  }

  /**
   * The courier was at the door and could not hand the parcel over. Counts
   * the attempt; the parcel then goes out again (up to the limit) or back
   * to its sender.
   */
  async recordFailedAttempt(
    trackingId: string,
    payload: FailedAttemptDto,
    actor: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (
      actor.role === Role.DELIVERY_PERSONNEL &&
      parcel.deliveryPersonnel?.id !== actor.id
    ) {
      throw new ForbiddenException('You can only update parcels assigned to you');
    }

    this.assertNotBlocked(parcel);
    this.assertTransitionAllowed(parcel.status, ParcelStatus.FAILED_ATTEMPT);

    const rescheduledFor = payload.rescheduledFor
      ? this.parseFutureDate(payload.rescheduledFor, 'rescheduledFor')
      : null;

    parcel.status = ParcelStatus.FAILED_ATTEMPT;
    parcel.deliveryAttempts = (parcel.deliveryAttempts ?? 0) + 1;
    parcel.lastFailureReason = payload.reason;
    parcel.rescheduledFor = rescheduledFor;
    parcel.deliveryCodeHash = null;
    if (rescheduledFor) {
      parcel.estimatedDeliveryAt = rescheduledFor;
    }

    const left = this.maxAttempts() - parcel.deliveryAttempts;
    const outcome =
      left > 0
        ? `${left} attempt${left === 1 ? '' : 's'} left`
        : 'no attempts left, returning to sender';
    // The courier's own words follow " — " so the public timeline can drop
    // them: they tend to say things like "phone off, neighbour says abroad".
    const note =
      `Delivery attempt ${parcel.deliveryAttempts} failed: ${FAILURE_LABELS[payload.reason]} (${outcome})` +
      (payload.note ? ` — ${payload.note}` : '');

    await this.persist(parcel, {
      status: ParcelStatus.FAILED_ATTEMPT,
      actor,
      note,
    });
    await this.auditService.record({
      actor,
      action: AuditAction.PARCEL_DELIVERY_FAILED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: `Attempt ${parcel.deliveryAttempts}: ${payload.reason}`,
      metadata: {
        attempt: parcel.deliveryAttempts,
        reason: payload.reason,
        note: payload.note ?? null,
        rescheduledFor: rescheduledFor?.toISOString() ?? null,
      },
    });

    return this.announce(trackingId);
  }

  /**
   * Picks the day for the next attempt after a failed one. The receiver
   * usually knows best, so they may set it, as may the sender or an admin.
   */
  async rescheduleDelivery(
    trackingId: string,
    payload: RescheduleDeliveryDto,
    actor: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    const mayReschedule =
      actor.role === Role.ADMIN ||
      parcel.receiver?.id === actor.id ||
      parcel.sender?.id === actor.id;
    if (!mayReschedule) {
      throw new ForbiddenException(
        'Only the receiver, the sender or an admin can reschedule a delivery',
      );
    }

    this.assertNotBlocked(parcel);
    if (parcel.status !== ParcelStatus.FAILED_ATTEMPT) {
      throw new BadRequestException(
        'Only a parcel whose delivery attempt failed can be rescheduled',
      );
    }
    this.assertAttemptsLeft(parcel);

    const rescheduledFor = this.parseFutureDate(
      payload.rescheduledFor,
      'rescheduledFor',
    );
    parcel.rescheduledFor = rescheduledFor;
    parcel.estimatedDeliveryAt = rescheduledFor;

    await this.persist(parcel, {
      status: parcel.status,
      actor,
      note:
        `Rescheduled for ${rescheduledFor.toISOString().slice(0, 10)}` +
        (payload.note ? ` — ${payload.note}` : ''),
    });
    await this.auditService.record({
      actor,
      action: AuditAction.PARCEL_RESCHEDULED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: `Rescheduled for ${rescheduledFor.toISOString()}`,
      metadata: { rescheduledFor: rescheduledFor.toISOString() },
    });

    return this.announce(trackingId);
  }

  /**
   * Changes a booking before anyone has collected it. The fee is re-priced
   * from the new values and the difference charged or credited; a parcel
   * whose fee was already paid online cannot change price, since the money
   * has moved — that is a cancel and a new booking.
   */
  async updateParcel(
    trackingId: string,
    payload: UpdateParcelDto,
    actor: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (actor.role !== Role.ADMIN && parcel.sender?.id !== actor.id) {
      throw new ForbiddenException('You can only edit your own parcels');
    }

    this.assertNotBlocked(parcel);
    if (parcel.status !== ParcelStatus.PENDING) {
      throw new BadRequestException(
        'This parcel has already been picked up — contact support to change it',
      );
    }

    const changed = (Object.keys(payload) as (keyof UpdateParcelDto)[]).filter(
      (key) => payload[key] !== undefined,
    );
    if (!changed.length) {
      throw new BadRequestException('Nothing to change');
    }

    const windowChanged =
      payload.pickupWindowStart !== undefined ||
      payload.pickupWindowEnd !== undefined;
    const pickupWindow = windowChanged
      ? this.parsePickupWindow(
          payload.pickupWindowStart ?? parcel.pickupWindowStart?.toISOString(),
          payload.pickupWindowEnd ?? parcel.pickupWindowEnd?.toISOString(),
        )
      : undefined;

    for (const key of [
      'receiverName',
      'receiverPhone',
      'pickupAddress',
      'deliveryAddress',
      'description',
      ...PRICED_FIELDS,
    ] as const) {
      if (payload[key] !== undefined) {
        Object.assign(parcel, { [key]: payload[key] });
      }
    }
    if (pickupWindow !== undefined) {
      parcel.pickupWindowStart = pickupWindow?.start ?? null;
      parcel.pickupWindowEnd = pickupWindow?.end ?? null;
    }

    const previousFee = parcel.deliveryFee;
    const repriced = PRICED_FIELDS.some((key) => payload[key] !== undefined);
    if (repriced) {
      const feeBreakdown = this.quote(parcel);

      if (
        feeBreakdown.total !== previousFee &&
        parcel.paymentStatus === PaymentStatus.PAID
      ) {
        throw new BadRequestException(
          'The fee for this parcel is already paid, so its price cannot change — cancel it and book again',
        );
      }

      parcel.feeBreakdown = feeBreakdown;
      parcel.deliveryFee = feeBreakdown.total;
      if (parcel.paymentStatus !== PaymentStatus.PAID) {
        parcel.paymentStatus =
          parcel.codAmount > 0 ? PaymentStatus.NOT_REQUIRED : PaymentStatus.UNPAID;
      }
    }
    if (repriced || windowChanged) {
      parcel.estimatedDeliveryAt = estimateDeliveryAt(
        parcel.pickupWindowEnd ?? new Date(),
        routeFor(parcel.pickupZone, parcel.deliveryZone),
        parcel.serviceTier,
      );
    }

    await this.persist(
      parcel,
      { status: parcel.status, actor, note: 'Booking details updated' },
      repricingEntries(parcel, previousFee),
    );
    await this.auditService.record({
      actor,
      action: AuditAction.PARCEL_UPDATED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: `Changed ${changed.join(', ')}`,
      metadata: {
        changed,
        ...(parcel.deliveryFee !== previousFee
          ? { feeFrom: previousFee, feeTo: parcel.deliveryFee }
          : {}),
      },
    });

    return this.announce(trackingId);
  }

  /**
   * Sends the receiver a new delivery code — for when the first email went
   * astray. The old code stops working.
   */
  async reissueDeliveryCode(
    trackingId: string,
    actor: User,
  ): Promise<{ message: string }> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (actor.role !== Role.ADMIN && parcel.receiver?.id !== actor.id) {
      throw new ForbiddenException(
        'Only the receiver can ask for a new delivery code',
      );
    }
    this.assertNotBlocked(parcel);
    if (parcel.status !== ParcelStatus.OUT_FOR_DELIVERY) {
      throw new BadRequestException(
        'A delivery code is only issued while the parcel is out for delivery',
      );
    }

    const code = this.issueDeliveryCode(parcel);
    await this.parcelRepository.update(parcel.id, {
      deliveryCodeHash: parcel.deliveryCodeHash,
      deliveryCodeAttempts: 0,
    });
    await this.auditService.record({
      actor,
      action: AuditAction.DELIVERY_CODE_REISSUED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
    });

    this.sendDeliveryCode(parcel, code);
    return { message: 'A new delivery code has been sent to the receiver' };
  }

  /**
   * Called by the payment module, inside its own transaction, once the
   * gateway has confirmed the money. Idempotent: a parcel already marked
   * paid is left alone and reported as such.
   */
  async markFeePaid(manager: EntityManager, parcelId: string): Promise<boolean> {
    const result = await manager.update(
      Parcel,
      { id: parcelId, paymentStatus: PaymentStatus.UNPAID },
      { paymentStatus: PaymentStatus.PAID },
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * The parcel a sender is about to pay for, after checking it is theirs and
   * still owes a fee.
   */
  async findPayableParcel(trackingId: string, payer: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.sender?.id !== payer.id) {
      throw new ForbiddenException('You can only pay for parcels you sent');
    }
    if (parcel.paymentStatus === PaymentStatus.NOT_REQUIRED) {
      throw new BadRequestException(
        'This parcel is cash on delivery — its fee comes out of the cash collected',
      );
    }
    if (parcel.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('This parcel is already paid for');
    }
    if (CLOSED_STATUSES.includes(parcel.status)) {
      throw new BadRequestException(
        `A ${parcel.status.toLowerCase().replace(/_/g, ' ')} parcel cannot be paid for`,
      );
    }

    return parcel;
  }

  /**
   * Books every row of a validated booking file. Rows are independent: one
   * that fails (an address book entry that cannot receive, say) is reported
   * and the rest still go through.
   */
  async bulkCreate(
    sender: User,
    rows: BulkRow[],
  ): Promise<{
    created: number;
    failed: number;
    results: { line: number; trackingId?: string; error?: string }[];
  }> {
    const results: { line: number; trackingId?: string; error?: string }[] = [];

    for (const row of rows) {
      try {
        const parcel = await this.create(sender, row.dto);
        results.push({ line: row.line, trackingId: parcel.trackingId });
      } catch (error) {
        results.push({
          line: row.line,
          error: error instanceof Error ? error.message : 'Could not book',
        });
      }
    }

    const created = results.filter((result) => result.trackingId).length;
    await this.auditService.record({
      actor: sender,
      action: AuditAction.PARCEL_BULK_BOOKED,
      targetType: AuditTargetType.USER,
      targetId: sender.id,
      summary: `Booked ${created} of ${rows.length} parcels from a file`,
      metadata: { rows: rows.length, created },
    });

    return { created, failed: rows.length - created, results };
  }

  /** A printable 4×6 label — for the sender, an admin or the courier. */
  async labelPdf(trackingId: string, viewer: User): Promise<Buffer> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    const mayPrint =
      viewer.role === Role.ADMIN ||
      parcel.sender?.id === viewer.id ||
      parcel.deliveryPersonnel?.id === viewer.id;
    if (!mayPrint) {
      throw new ForbiddenException(
        'Only the sender, an admin or the assigned courier can print a label',
      );
    }

    return renderLabel(parcel, this.trackingUrl(parcel));
  }

  /** The fee invoice — the sender's and an admin's business only. */
  async invoicePdf(trackingId: string, viewer: User): Promise<Buffer> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (viewer.role !== Role.ADMIN && parcel.sender?.id !== viewer.id) {
      throw new ForbiddenException(
        'Only the sender or an admin can download the invoice',
      );
    }

    return renderInvoice(parcel, this.trackingUrl(parcel));
  }

  /**
   * Puts an approved courier on a parcel. Re-assigning an already-assigned
   * parcel is allowed — that is how a handover between couriers is recorded.
   */
  async assignDeliveryPersonnel(
    trackingId: string,
    deliveryPersonnelId: string,
    admin: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.isBlocked) {
      throw new BadRequestException('Parcel is blocked');
    }

    if (CLOSED_STATUSES.includes(parcel.status)) {
      throw new BadRequestException(
        `Cannot assign a ${parcel.status.toLowerCase()} parcel`,
      );
    }

    const courier =
      await this.userService.findDeliveryPersonnelOrFail(deliveryPersonnelId);

    parcel.deliveryPersonnel = courier;
    await this.persist(parcel, {
      status: parcel.status,
      actor: admin,
      // First name only: these notes surface on the public tracking page.
      note: `Assigned to ${firstName(courier.name)}`,
    });
    await this.auditService.record({
      actor: admin,
      action: AuditAction.PARCEL_ASSIGNED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      // The audit trail is internal, so it keeps the full name.
      summary: `Assigned to ${courier.name} (${courier.email})`,
      metadata: { courierId: courier.id, courierEmail: courier.email },
    });

    return this.announce(trackingId);
  }

  /** Removes the courier without changing the parcel's status. */
  async unassignDeliveryPersonnel(
    trackingId: string,
    admin: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (!parcel.deliveryPersonnel) {
      throw new BadRequestException('Parcel has no delivery personnel');
    }

    const previousCourier = parcel.deliveryPersonnel;
    const previousName = firstName(previousCourier.name);
    parcel.deliveryPersonnel = null;
    await this.persist(parcel, {
      status: parcel.status,
      actor: admin,
      note: `Unassigned from ${previousName}`,
    });
    await this.auditService.record({
      actor: admin,
      action: AuditAction.PARCEL_UNASSIGNED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: `Unassigned from ${previousCourier.name} (${previousCourier.email})`,
      metadata: { courierId: previousCourier.id },
    });

    return this.announce(trackingId);
  }

  /** Everything currently on a courier's plate — closed parcels excluded. */
  async getAssignedParcels(
    courier: User,
    query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.findPage(query, {
      deliveryPersonnel: { id: courier.id },
      status: Not(In(CLOSED_STATUSES)),
    });
  }

  /** A courier's completed deliveries, most recently updated first. */
  async getCompletedDeliveries(
    courier: User,
    query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.findPage(
      query,
      {
        deliveryPersonnel: { id: courier.id },
        status: ParcelStatus.DELIVERED,
      },
      'updatedAt',
    );
  }

  /**
   * The booker pulling their own parcel back — a sender, or an admin for a
   * parcel they booked themselves. An admin cancelling someone else's parcel
   * is a different act and goes through the status route.
   */
  async cancelParcel(trackingId: string, sender: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.sender.id !== sender.id) {
      throw new ForbiddenException('You can only cancel your own parcels');
    }

    this.assertNotBlocked(parcel);
    this.assertTransitionAllowed(parcel.status, ParcelStatus.CANCELLED);

    // Once a courier has the parcel, pulling it back is an operational
    // decision: an admin can still cancel it through the status route.
    if (parcel.status !== ParcelStatus.PENDING) {
      throw new BadRequestException(
        'This parcel has already been picked up — contact support to cancel it',
      );
    }

    parcel.status = ParcelStatus.CANCELLED;
    await this.persist(
      parcel,
      {
        status: ParcelStatus.CANCELLED,
        actor: sender,
        note: 'Cancelled by sender',
      },
      async (manager) =>
        cancellationEntries(
          parcel,
          await this.ledgerService.feeChargedFor(manager, parcel.id),
        ),
    );
    await this.auditService.record({
      actor: sender,
      action: AuditAction.PARCEL_CANCELLED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: 'Cancelled by its sender before pickup',
    });

    return this.announce(trackingId);
  }

  async confirmDelivery(trackingId: string, receiver: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.receiver.id !== receiver.id) {
      throw new ForbiddenException('You can only confirm your own parcels');
    }

    this.assertNotBlocked(parcel);
    this.assertTransitionAllowed(parcel.status, ParcelStatus.DELIVERED);

    const ledger = this.markDelivered(parcel);
    await this.persist(
      parcel,
      {
        status: ParcelStatus.DELIVERED,
        actor: receiver,
        note: 'Delivery confirmed by receiver',
      },
      ledger,
    );
    await this.auditService.record({
      actor: receiver,
      action: AuditAction.PARCEL_DELIVERY_CONFIRMED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: 'Receiver confirmed delivery',
    });

    return this.announce(trackingId);
  }

  async blockParcel(trackingId: string, admin: User): Promise<Parcel> {
    return this.setBlocked(trackingId, true, admin);
  }

  /** Releases a hold, returning the parcel to wherever it was in its journey. */
  async unblockParcel(trackingId: string, admin: User): Promise<Parcel> {
    return this.setBlocked(trackingId, false, admin);
  }

  private async setBlocked(
    trackingId: string,
    blocked: boolean,
    admin: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.isBlocked === blocked) {
      throw new BadRequestException(
        `Parcel is ${blocked ? 'already' : 'not'} blocked`,
      );
    }

    parcel.isBlocked = blocked;
    await this.persist(parcel, {
      status: parcel.status,
      actor: admin,
      // `describeEvent` keys the realtime event type off these prefixes.
      note: blocked ? 'Parcel blocked by admin' : 'Parcel unblocked by admin',
    });
    await this.auditService.record({
      actor: admin,
      action: blocked
        ? AuditAction.PARCEL_BLOCKED
        : AuditAction.PARCEL_UNBLOCKED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: `${blocked ? 'Blocked' : 'Unblocked'} while ${parcel.status}`,
      metadata: { status: parcel.status },
    });

    return this.announce(trackingId);
  }

  async getMyParcels(
    sender: User,
    query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.findPage(query, { sender: { id: sender.id } });
  }

  async getIncomingParcels(
    receiver: User,
    query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    // A parcel on its way back is no longer coming to them.
    return this.findPage(query, {
      receiver: { id: receiver.id },
      status: Not(In([...CLOSED_STATUSES, ParcelStatus.RETURNING])),
    });
  }

  async getDeliveryHistory(
    receiver: User,
    query: QueryParcelsDto,
  ): Promise<Paginated<Parcel>> {
    return this.findPage(
      query,
      { receiver: { id: receiver.id }, status: ParcelStatus.DELIVERED },
      'updatedAt',
    );
  }

  async getAllParcels(query: QueryParcelsDto): Promise<Paginated<Parcel>> {
    return this.findPage(query, {});
  }

  /**
   * Records what was captured at handover and closes the parcel out.
   *
   * Kept separate from `updateStatus` because proof is evidence rather than a
   * state change — it carries images, who signed, and whether cash changed
   * hands, none of which belong in a status payload.
   */
  async submitDeliveryProof(
    trackingId: string,
    payload: DeliveryProofDto,
    actor: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (actor.role === Role.DELIVERY_PERSONNEL) {
      if (parcel.deliveryPersonnel?.id !== actor.id) {
        throw new ForbiddenException(
          'You can only submit proof for parcels assigned to you',
        );
      }
    }

    this.assertNotBlocked(parcel);

    if (parcel.status === ParcelStatus.CANCELLED) {
      throw new BadRequestException('Cannot deliver a cancelled parcel');
    }

    if (parcel.codAmount > 0 && !payload.codCollected) {
      throw new BadRequestException(
        `This parcel is cash on delivery (${parcel.codAmount}) — confirm collection with codCollected`,
      );
    }

    // Proof is only meaningful alongside the transition it evidences. A
    // parcel that is already delivered keeps the time it was delivered at;
    // the proof is being attached after the fact.
    const alreadyDelivered = parcel.status === ParcelStatus.DELIVERED;
    if (!alreadyDelivered) {
      this.assertTransitionAllowed(parcel.status, ParcelStatus.DELIVERED);

      // Cash has to end up in somebody's hands on the ledger.
      if (parcel.codAmount > 0 && !parcel.deliveryPersonnel) {
        throw new BadRequestException(
          'Assign the courier who collected the cash before recording delivery',
        );
      }

      // Checked last, so a request refused for another reason does not
      // spend one of the receiver's code attempts.
      await this.verifyDeliveryCode(parcel, payload.deliveryCode, actor);
    }

    parcel.deliveryProofImages = payload.images;
    parcel.deliveryProofNote = payload.note ?? null;
    parcel.receivedBy = payload.receivedBy ?? parcel.receiverName;
    parcel.isCodCollected = payload.codCollected ?? parcel.isCodCollected;

    const ledger = this.markDelivered(parcel);

    await this.persist(
      parcel,
      {
        status: ParcelStatus.DELIVERED,
        actor,
        note:
          payload.note ??
          (alreadyDelivered
            ? 'Proof of delivery added'
            : `Delivered to ${parcel.receivedBy}`),
      },
      // Money moves once, on the handover itself — not again when proof is
      // attached to a parcel that was already delivered.
      alreadyDelivered ? [] : ledger,
    );
    await this.auditService.record({
      actor,
      action: AuditAction.PARCEL_PROOF_SUBMITTED,
      targetType: AuditTargetType.PARCEL,
      targetId: parcel.trackingId,
      summary: alreadyDelivered
        ? 'Proof added to a delivered parcel'
        : `Delivered to ${parcel.receivedBy}`,
      metadata: {
        images: payload.images.length,
        receivedBy: parcel.receivedBy,
        codAmount: parcel.codAmount,
        codCollected: parcel.isCodCollected,
      },
    });

    return this.announce(trackingId);
  }

  /**
   * The whole parcel — contact details, proof, fee breakdown and timeline —
   * for the people it concerns: an admin, or its sender, receiver or courier.
   * Everyone else gets the trimmed public view from `getByTrackingId`.
   */
  async getDetails(trackingId: string, viewer: User): Promise<Parcel> {
    const parcel = await this.getParcelWithLogs(trackingId);

    const isParty = [
      parcel.sender?.id,
      parcel.receiver?.id,
      parcel.deliveryPersonnel?.id,
    ].includes(viewer.id);

    if (viewer.role !== Role.ADMIN && !isParty) {
      throw new ForbiddenException(
        'You can only open parcels you sent, are receiving, or are delivering',
      );
    }

    return parcel;
  }

  /**
   * Public tracking lookup. Returns the trimmed `PublicParcel` — no nested
   * user records — because this is the one parcel route with no guard on it.
   */
  async getByTrackingId(trackingId: string): Promise<PublicParcel> {
    return toPublicParcel(await this.getParcelWithLogs(trackingId));
  }

  /** Aggregates used by the dashboard, so it never queries parcels itself. */
  async getStats(): Promise<ParcelStats> {
    const [totalParcels, blockedParcels, statusRows] = await Promise.all([
      this.parcelRepository.count(),
      this.parcelRepository.count({ where: { isBlocked: true } }),
      this.parcelRepository
        .createQueryBuilder('parcel')
        .select('parcel.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('parcel.status')
        .getRawMany<{ status: string; count: string }>(),
    ]);

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

    return { totalParcels, blockedParcels, parcelsByStatus };
  }

  /**
   * Trend aggregates for the admin dashboard.
   *
   * Every figure is computed in Postgres rather than by loading parcels and
   * reducing in Node — the point of these numbers is that they stay cheap as
   * the table grows.
   */
  async getTrends(days: number): Promise<DashboardTrends> {
    const since = new Date(Date.now() - days * 86_400_000);

    const [daily, statusTimings, courierThroughput, revenue, fulfilment] =
      await Promise.all([
        this.dailyCounts(since),
        this.statusTimings(since),
        this.courierThroughput(since),
        this.revenueSummary(since),
        this.averageFulfilmentHours(since),
      ]);

    return {
      rangeDays: days,
      daily,
      statusTimings,
      courierThroughput,
      revenue,
      averageFulfilmentHours: fulfilment,
    };
  }

  /** One row per day in the window, zero-filled so charts have no gaps. */
  private async dailyCounts(since: Date): Promise<DailyCount[]> {
    return this.rawQuery<DailyCount>(
      `SELECT to_char(d.day, 'YYYY-MM-DD')                        AS date,
              COALESCE(c.created, 0)::int                          AS created,
              COALESCE(v.delivered, 0)::int                        AS delivered
         FROM generate_series($1::date, CURRENT_DATE, '1 day') AS d(day)
         LEFT JOIN (
           SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*) AS created
             FROM parcels WHERE "createdAt" >= $1 GROUP BY 1
         ) c ON c.day = d.day
         LEFT JOIN (
           SELECT date_trunc('day', "deliveredAt")::date AS day, COUNT(*) AS delivered
             FROM parcels WHERE "deliveredAt" >= $1 GROUP BY 1
         ) v ON v.day = d.day
        ORDER BY d.day`,
      [since],
    );
  }

  /**
   * Mean time a parcel spends in each status, from consecutive status-log
   * entries. A parcel currently sitting in a status has no next entry yet and
   * is excluded, so this measures completed dwell time only.
   */
  private async statusTimings(since: Date): Promise<StatusTiming[]> {
    const rows = await this.rawQuery<{
      status: string;
      averageHours: string | null;
      sampleSize: number;
    }>(
      // Assigning, unassigning and blocking each append a log row without
      // changing the status. `changes` drops those repeats first, so a span
      // runs from entering a status to leaving it rather than being cut short
      // at the next note.
      `WITH ordered AS (
         SELECT "parcelId", status, "createdAt",
                LAG(status) OVER (
                  PARTITION BY "parcelId" ORDER BY "createdAt"
                ) AS previous
           FROM parcel_status_logs
          WHERE "createdAt" >= $1
       ),
       changes AS (
         SELECT "parcelId", status, "createdAt"
           FROM ordered
          WHERE previous IS DISTINCT FROM status
       ),
       spans AS (
         SELECT status,
                LEAD("createdAt") OVER (
                  PARTITION BY "parcelId" ORDER BY "createdAt"
                ) - "createdAt" AS dwell
           FROM changes
       )
       SELECT status,
              ROUND(AVG(EXTRACT(EPOCH FROM dwell) / 3600)::numeric, 2) AS "averageHours",
              COUNT(*)::int AS "sampleSize"
         FROM spans
        WHERE dwell IS NOT NULL
        GROUP BY status
        ORDER BY status`,
      [since],
    );

    return rows.map((r) => ({
      status: r.status,
      averageHours: r.averageHours === null ? null : Number(r.averageHours),
      sampleSize: r.sampleSize,
    }));
  }

  /** Per courier, over parcels booked inside the window. */
  private async courierThroughput(since: Date): Promise<CourierThroughput[]> {
    const rows = await this.rawQuery<{
      courierId: string;
      courierName: string;
      active: number;
      delivered: number;
      averageDeliveryHours: string | null;
    }>(
      `SELECT u.id                                                   AS "courierId",
              u.name                                                 AS "courierName",
              COUNT(*) FILTER (WHERE p.status NOT IN ('DELIVERED','CANCELLED','RETURNED_TO_SENDER'))::int AS active,
              COUNT(*) FILTER (WHERE p.status = 'DELIVERED')::int     AS delivered,
              ROUND(AVG(
                EXTRACT(EPOCH FROM (p."deliveredAt" - p."createdAt")) / 3600
              ) FILTER (WHERE p."deliveredAt" IS NOT NULL)::numeric, 2)
                                                                     AS "averageDeliveryHours"
         FROM users u
         JOIN parcels p ON p."deliveryPersonnelId" = u.id
        WHERE p."createdAt" >= $1
        GROUP BY u.id, u.name
        ORDER BY delivered DESC, active DESC`,
      [since],
    );

    return rows.map((r) => ({
      ...r,
      averageDeliveryHours:
        r.averageDeliveryHours === null ? null : Number(r.averageDeliveryHours),
    }));
  }

  /** Money on parcels booked inside the window. */
  private async revenueSummary(since: Date): Promise<RevenueSummary> {
    // Postgres returns `numeric` sums as strings.
    const [row] = await this.rawQuery<Record<keyof RevenueSummary, string>>(
      `SELECT COALESCE(SUM("deliveryFee") FILTER (WHERE status <> 'CANCELLED'), 0)   AS "deliveryFeesBooked",
              COALESCE(SUM("deliveryFee") FILTER (WHERE status = 'DELIVERED'), 0)    AS "deliveryFeesDelivered",
              COALESCE(SUM("codAmount") FILTER (
                WHERE "isCodCollected" = false AND status NOT IN ('DELIVERED','CANCELLED','RETURNED_TO_SENDER','RETURNING')
              ), 0)                                                                  AS "codOutstanding",
              COALESCE(SUM("codAmount") FILTER (WHERE "isCodCollected" = true), 0)   AS "codCollected"
         FROM parcels
        WHERE "createdAt" >= $1`,
      [since],
    );

    return {
      deliveryFeesBooked: Number(row.deliveryFeesBooked),
      deliveryFeesDelivered: Number(row.deliveryFeesDelivered),
      codOutstanding: Number(row.codOutstanding),
      codCollected: Number(row.codCollected),
    };
  }

  private async averageFulfilmentHours(since: Date): Promise<number | null> {
    const [row] = await this.rawQuery<{ hours: string | null }>(
      `SELECT ROUND(AVG(
                EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) / 3600
              )::numeric, 2) AS hours
         FROM parcels
        WHERE "deliveredAt" IS NOT NULL AND "deliveredAt" >= $1`,
      [since],
    );

    return row?.hours === null || row?.hours === undefined
      ? null
      : Number(row.hours);
  }

  /** `Repository.query` resolves to `any`; this names the row shape once. */
  private rawQuery<Row>(sql: string, parameters: unknown[]): Promise<Row[]> {
    return this.parcelRepository.query(sql, parameters);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /**
   * Receivers are addressed by id when the sender picked an existing account,
   * and by email otherwise — in which case a placeholder account is created.
   */
  private async resolveReceiver(
    payload: CreateParcelDto,
  ): Promise<{ user: User; created: boolean }> {
    if (payload.receiverId) {
      const user = await this.userService.findEntityByIdOrFail(
        payload.receiverId,
      );
      this.userService.assertCanReceive(user);
      return { user, created: false };
    }

    if (payload.receiverEmail) {
      return this.userService.findOrCreateReceiver({
        name: payload.receiverName,
        email: payload.receiverEmail,
        phone: payload.receiverPhone,
      });
    }

    throw new BadRequestException(
      'Either receiverId or receiverEmail is required',
    );
  }

  /**
   * One query builder for every parcel list, so filters, ordering and the
   * response envelope cannot drift between them.
   */
  private async findPage(
    query: QueryParcelsDto,
    scope: Record<string, unknown>,
    orderBy: 'createdAt' | 'updatedAt' = 'createdAt',
  ): Promise<Paginated<Parcel>> {
    const filters: Record<string, unknown> = { ...scope };

    // An explicit status filter narrows the caller's scope; it never widens it.
    if (query.status && !('status' in scope)) {
      filters.status = query.status;
    }
    if (query.isBlocked !== undefined) {
      filters.isBlocked = query.isBlocked;
    }
    if (query.unassigned) {
      filters.deliveryPersonnel = IsNull();
    }

    const createdAt = dateRange(query.from, query.to);
    if (createdAt) {
      filters.createdAt = createdAt;
    }

    // `find` ORs an array of conditions, which is how one search term can match
    // any of three columns while every other filter still applies.
    const searchable = ['trackingId', 'senderName', 'receiverName'];
    const term = query.search ? `%${escapeLike(query.search)}%` : null;
    const where = term
      ? searchable.map((field) => ({ ...filters, [field]: ILike(term) }))
      : filters;

    const [data, total] = await this.parcelRepository.findAndCount({
      where: where as never,
      relations: LIST_RELATIONS,
      order: { [orderBy]: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });

    return paginate(sanitizeParcels(data), total, query.page, query.limit);
  }

  private assertTransitionAllowed(from: ParcelStatus, to: ParcelStatus): void {
    if (from === to) {
      throw new BadRequestException(`Parcel is already ${from}`);
    }

    const allowed = PARCEL_STATUS_TRANSITIONS[from] ?? [];

    if (!allowed.includes(to)) {
      throw new BadRequestException(
        allowed.length
          ? `Cannot move a parcel from ${from} to ${to}. Allowed: ${allowed.join(', ')}`
          : `${from} is a final status and cannot be changed`,
      );
    }
  }

  private assertNotBlocked(parcel: Parcel): void {
    if (parcel.isBlocked) {
      throw new BadRequestException('Parcel is blocked');
    }
  }

  /**
   * The one way a parcel becomes DELIVERED, whichever route asked for it.
   *
   * Three routes can close a parcel out (status update, receiver confirmation
   * and delivery proof) and they used to disagree: only proof stamped
   * `deliveredAt` and only proof checked that cash had been collected.
   */
  private markDelivered(parcel: Parcel): LedgerDraft[] {
    if (parcel.codAmount > 0 && !parcel.isCodCollected) {
      throw new BadRequestException(
        `This parcel is cash on delivery (${parcel.codAmount}) — the courier must submit delivery proof with codCollected before it can be marked delivered`,
      );
    }

    parcel.status = ParcelStatus.DELIVERED;
    parcel.deliveredAt ??= new Date();
    parcel.deliveryCodeHash = null;
    parcel.rescheduledFor = null;

    return deliveryEntries(parcel);
  }

  /**
   * Saves a parcel together with the status-log row describing the change,
   * and any money the change moves, in one transaction — so a parcel never
   * moves without its timeline entry or its ledger entries.
   *
   * `ledger` may be a function when the entries depend on what is already in
   * the ledger, so they are read inside the same transaction.
   */
  private async persist(
    parcel: Parcel,
    log: { status: ParcelStatus; actor: User; note?: string },
    ledger:
      | LedgerDraft[]
      | ((manager: EntityManager) => Promise<LedgerDraft[]>) = [],
  ): Promise<void> {
    await this.parcelRepository.manager.transaction(async (manager) => {
      await manager.save(parcel);
      await manager.save(
        manager.create(ParcelStatusLog, {
          parcel,
          status: log.status,
          changedBy: log.actor,
          note: log.note,
        }),
      );

      const drafts =
        typeof ledger === 'function' ? await ledger(manager) : ledger;
      await this.ledgerService.post(
        manager,
        drafts.map((draft) => ({ ...draft, createdById: log.actor.id })),
      );
    });
  }

  private rates(): PricingRates {
    return ratesFromEnv((key) => this.config.get<string>(key));
  }

  private flag(key: string): boolean {
    return this.config.get<string>(key) === 'true';
  }

  private maxAttempts(): number {
    const configured = Number(this.config.get<string>('MAX_DELIVERY_ATTEMPTS'));
    return Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_MAX_DELIVERY_ATTEMPTS;
  }

  private assertAttemptsLeft(parcel: Parcel): void {
    if ((parcel.deliveryAttempts ?? 0) >= this.maxAttempts()) {
      throw new BadRequestException(
        `Delivery has failed ${parcel.deliveryAttempts} times — return this parcel to its sender`,
      );
    }
  }

  private trackingUrl(parcel: Parcel): string {
    return `${webBaseUrl(this.config)}/track/${parcel.trackingId}`;
  }

  /** Server secret the delivery codes are keyed with. */
  private codeSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  /** Sets a fresh code on the parcel (unsaved) and returns it in clear. */
  private issueDeliveryCode(parcel: Parcel): string {
    const code = generateDeliveryCode();
    parcel.deliveryCodeHash = hashDeliveryCode(parcel.id, code, this.codeSecret());
    parcel.deliveryCodeAttempts = 0;
    return code;
  }

  /** Mails the code behind the response; only its hash was stored. */
  private sendDeliveryCode(parcel: Parcel, code: string): void {
    this.background.run(`Delivery code for ${parcel.trackingId}`, () =>
      this.notifications.sendDeliveryCode(parcel, code),
    );
  }

  /**
   * Checks the code the courier typed in. A code that is sent is always
   * checked; a missing one is only refused from a courier, and only when
   * REQUIRE_DELIVERY_OTP is on. An admin closing a parcel by hand is an
   * audited override and needs none.
   *
   * Wrong guesses are counted outside the delivery's transaction, so a
   * refused attempt still counts.
   */
  private async verifyDeliveryCode(
    parcel: Parcel,
    code: string | undefined,
    actor: User,
  ): Promise<void> {
    if (!code) {
      if (
        actor.role === Role.DELIVERY_PERSONNEL &&
        this.flag('REQUIRE_DELIVERY_OTP')
      ) {
        throw new BadRequestException(
          'Ask the receiver for their delivery code and send it as deliveryCode',
        );
      }
      return;
    }

    const stored = await this.parcelRepository
      .createQueryBuilder('parcel')
      .select('parcel.id')
      .addSelect(['parcel.deliveryCodeHash', 'parcel.deliveryCodeAttempts'])
      .where('parcel.id = :id', { id: parcel.id })
      .getOne();

    if (!stored?.deliveryCodeHash) {
      throw new BadRequestException(
        'No delivery code is active for this parcel — it is issued when the parcel goes out for delivery',
      );
    }
    if (stored.deliveryCodeAttempts >= MAX_DELIVERY_CODE_ATTEMPTS) {
      throw new BadRequestException(
        'Too many wrong codes — the receiver must request a new one',
      );
    }

    if (
      !deliveryCodeMatches(parcel.id, code, stored.deliveryCodeHash, this.codeSecret())
    ) {
      const attempts = stored.deliveryCodeAttempts + 1;
      await this.parcelRepository.update(parcel.id, {
        deliveryCodeAttempts: attempts,
      });
      const left = MAX_DELIVERY_CODE_ATTEMPTS - attempts;
      throw new BadRequestException(
        left > 0
          ? `Wrong delivery code — ${left} attempt${left === 1 ? '' : 's'} left`
          : 'Wrong delivery code — the receiver must request a new one',
      );
    }
  }

  /** Both ends or neither; the end after the start; within the horizon. */
  private parsePickupWindow(
    start?: string | null,
    end?: string | null,
  ): { start: Date; end: Date } | null {
    if (!start && !end) return null;
    if (!start || !end) {
      throw new BadRequestException(
        'Send both pickupWindowStart and pickupWindowEnd, or neither',
      );
    }

    const from = this.parseFutureDate(start, 'pickupWindowStart');
    const to = this.parseFutureDate(end, 'pickupWindowEnd');

    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException(
        'pickupWindowEnd must be after pickupWindowStart',
      );
    }
    if (to.getTime() - from.getTime() > MAX_PICKUP_WINDOW_MS) {
      throw new BadRequestException('A pickup window can be at most 12 hours');
    }

    return { start: from, end: to };
  }

  private parseFutureDate(value: string, field: string): Date {
    const date = new Date(value);
    const now = Date.now();

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} is not a valid date`);
    }
    if (date.getTime() < now - CLOCK_SKEW_MS) {
      throw new BadRequestException(`${field} must not be in the past`);
    }
    if (date.getTime() > now + BOOKING_HORIZON_MS) {
      throw new BadRequestException(`${field} must be within the next 14 days`);
    }

    return date;
  }

  private assertCourierMaySetStatus(
    parcel: Parcel,
    status: ParcelStatus,
    courier: User,
  ): void {
    if (parcel.deliveryPersonnel?.id !== courier.id) {
      throw new ForbiddenException(
        'You can only update parcels assigned to you',
      );
    }

    if (!COURIER_STATUSES.includes(status)) {
      throw new ForbiddenException(
        `Delivery personnel cannot set status ${status}`,
      );
    }
  }

  /**
   * Single exit point for every mutation: re-read with relations, then
   * re-index for the assistant and tell whoever cares.
   *
   * Neither side effect is awaited. Together they are an embedding call, a
   * vector upsert, a few inserts and up to two SMTP round trips — seconds of
   * work the caller has no use for, since the write is already committed and
   * neither can undo it. They run behind the response instead.
   */
  private async announce(trackingId: string): Promise<Parcel> {
    const parcel = await this.getParcelWithLogs(trackingId);

    this.background.run(`Indexing ${trackingId}`, () =>
      this.ragService.indexParcel(this.toIndexDocument(parcel)),
    );
    this.background.run(`Notifying about ${trackingId}`, () =>
      this.notifications.notifyStatusChange(parcel),
    );

    return parcel;
  }

  private async findByTrackingIdOrFail(trackingId: string): Promise<Parcel> {
    const parcel = await this.parcelRepository.findOne({
      where: { trackingId },
      relations: ['sender', 'receiver', 'deliveryPersonnel'],
    });

    if (!parcel) {
      throw new NotFoundException('Parcel not found');
    }

    return parcel;
  }

  private async getParcelWithLogs(trackingId: string): Promise<Parcel> {
    const parcel = await this.parcelRepository.findOne({
      where: { trackingId },
      relations: PARCEL_RELATIONS,
    });

    if (!parcel) {
      throw new NotFoundException('Parcel not found');
    }

    parcel.statusLogs?.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    // Every public read and every mutation returns through here, so this is
    // the one place the nested users need scrubbing.
    return sanitizeParcel(parcel);
  }

  /**
   * Rebuilds the assistant's copy of every parcel from this table. Needed for
   * parcels indexed before owner ids were stored, and for any that were never
   * indexed at all — neither is visible to a non-admin until it is rewritten.
   *
   * Paged by id so memory stays flat and a parcel created mid-run cannot shift
   * the pages; each page is one embedding call.
   */
  async reindexAll(): Promise<{ indexed: number; removed: number }> {
    this.ragService.assertAvailable();

    let indexed = 0;
    let lastId: string | undefined;
    const ids = new Set<string>();

    for (;;) {
      const page = await this.parcelRepository.find({
        where: lastId ? { id: MoreThan(lastId) } : {},
        relations: ['sender', 'receiver', 'deliveryPersonnel', 'statusLogs'],
        order: { id: 'ASC' },
        take: REINDEX_PAGE_SIZE,
      });
      if (!page.length) break;

      for (const parcel of page) {
        parcel.statusLogs?.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
      }
      await this.ragService.indexParcels(
        page.map((parcel) => this.toIndexDocument(parcel)),
      );

      indexed += page.length;
      lastId = page[page.length - 1].id;
      for (const parcel of page) ids.add(parcel.id);
    }

    // Whatever is left in the index now belongs to no parcel in this table.
    const removed = await this.ragService.pruneParcelsExcept(ids);

    this.logger.log(
      `Re-indexed ${indexed} parcels for the assistant, removed ${removed} stale`,
    );
    return { indexed, removed };
  }

  /** Expects `statusLogs` oldest first — the note indexed is the latest one. */
  private toIndexDocument(parcel: Parcel): ParcelIndexDocument {
    return {
      id: parcel.id,
      trackingCode: parcel.trackingId,
      status: parcel.status,
      origin: parcel.pickupAddress,
      destination: parcel.deliveryAddress,
      recipientName: parcel.receiverName,
      updatedAt: parcel.updatedAt.toISOString(),
      notes: parcel.statusLogs?.[parcel.statusLogs.length - 1]?.note,
      senderId: parcel.sender?.id,
      receiverId: parcel.receiver?.id,
      courierId: parcel.deliveryPersonnel?.id,
    };
  }

  /**
   * `TRK-` plus twelve characters from the OS random source. The column is
   * unique, so a candidate is checked before use instead of letting the rare
   * collision surface as a failed insert.
   */
  private async generateTrackingId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const trackingId = `TRK-${randomTrackingSuffix()}`;

      if (!(await this.parcelRepository.exists({ where: { trackingId } }))) {
        return trackingId;
      }
    }

    throw new Error('Could not allocate a unique tracking id');
  }
}

const TRACKING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford base32: no I, L, O or U, so a code survives being read aloud. */
function randomTrackingSuffix(length = 12): string {
  // 32 symbols divide 256 evenly, so the modulo introduces no bias.
  return Array.from(
    randomBytes(length),
    (byte) => TRACKING_ALPHABET[byte % TRACKING_ALPHABET.length],
  ).join('');
}
