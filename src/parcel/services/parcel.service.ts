import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  ILike,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Paginated, paginate } from '../../common/types/paginated.type';
import { firstName } from '../../common/utils/name.util';
import { User } from '../../user/entities/user.entity';
import { RagService } from '../../rag/services/rag.service';
import { UserService } from '../../user/services/user.service';
import { Role } from '../../user/types/user.types';
import { CreateParcelDto } from '../dto/create-parcel.dto';
import { DeliveryProofDto } from '../dto/delivery-proof.dto';
import { QueryParcelsDto } from '../dto/query-parcels.dto';
import { UpdateParcelStatusDto } from '../dto/update-parcel-status.dto';
import { ParcelStatusLog } from '../entities/parcel-status-log.entity';
import { Parcel } from '../entities/parcel.entity';
import { calculateDeliveryFee, ratesFromEnv } from '../utils/pricing.util';
import { toPublicParcel } from '../utils/public-parcel.util';
import { PasswordResetService } from '../../auth/services/password-reset.service';
import { ParcelNotificationService } from './parcel-notification.service';
import { sanitizeParcel, sanitizeParcels } from '../utils/sanitize-parcel.util';
import {
  PARCEL_STATUS_TRANSITIONS,
  ParcelIndexDocument,
  ParcelStats,
  ParcelStatus,
  PublicParcel,
} from '../types/parcel.types';

const PARCEL_RELATIONS = [
  'sender',
  'receiver',
  'deliveryPersonnel',
  'statusLogs',
  'statusLogs.changedBy',
];

/**
 * Statuses a courier may set on a parcel assigned to them. Cancelling stays
 * with the sender and blocking stays with an admin, so neither appears here.
 */
const COURIER_STATUSES: ParcelStatus[] = [
  ParcelStatus.PICKED_UP,
  ParcelStatus.IN_TRANSIT,
  ParcelStatus.OUT_FOR_DELIVERY,
  ParcelStatus.DELIVERED,
];

/** Builds the right TypeORM operator for whichever bounds were supplied. */
function dateRange(
  from?: string,
  to?: string,
): ReturnType<typeof Between> | ReturnType<typeof MoreThanOrEqual> | undefined {
  if (from && to) return Between(new Date(from), new Date(to));
  if (from) return MoreThanOrEqual(new Date(from));
  if (to) return LessThanOrEqual(new Date(to));
  return undefined;
}

/** A parcel in one of these states is finished — nothing more to assign. */
const CLOSED_STATUSES: ParcelStatus[] = [
  ParcelStatus.DELIVERED,
  ParcelStatus.CANCELLED,
];

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
    @InjectRepository(ParcelStatusLog)
    private readonly statusLogRepository: Repository<ParcelStatusLog>,
    private readonly userService: UserService,
    private readonly ragService: RagService,
    private readonly notifications: ParcelNotificationService,
    private readonly config: ConfigService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  async create(sender: User, payload: CreateParcelDto): Promise<Parcel> {
    if (sender.role !== Role.SENDER && sender.role !== Role.ADMIN) {
      throw new ForbiddenException('Only senders can create parcels');
    }

    const { user: receiver, created: receiverIsNew } =
      await this.resolveReceiver(payload);

    const weightKg = payload.weightKg ?? 1;
    const codAmount = payload.codAmount ?? 0;
    // Priced here, never taken from the request.
    const { total: deliveryFee } = calculateDeliveryFee(
      weightKg,
      codAmount,
      ratesFromEnv((key) => this.config.get<string>(key)),
    );

    const parcel = this.parcelRepository.create({
      trackingId: this.generateTrackingId(),
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
      deliveryFee,
      status: ParcelStatus.PENDING,
      statusLogs: [
        {
          status: ParcelStatus.PENDING,
          note: 'Parcel created',
          changedBy: sender,
        },
      ],
    });

    const savedParcel = await this.parcelRepository.save(parcel);
    const freshParcel = await this.getParcelWithLogs(savedParcel.trackingId);
    await this.triggerParcelIndex(freshParcel);

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

    this.assertTransitionAllowed(parcel.status, payload.status);

    parcel.status = payload.status;
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(parcel, payload.status, actor, payload.note);

    return this.refreshAndIndex(trackingId);
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
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(
      parcel,
      parcel.status,
      admin,
      // First name only: these notes surface on the public tracking page.
      `Assigned to ${firstName(courier.name)}`,
    );

    return this.refreshAndIndex(trackingId);
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

    const previousName = firstName(parcel.deliveryPersonnel.name);
    parcel.deliveryPersonnel = null;
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(
      parcel,
      parcel.status,
      admin,
      `Unassigned from ${previousName}`,
    );

    return this.refreshAndIndex(trackingId);
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

  async cancelParcel(trackingId: string, sender: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.sender.id !== sender.id) {
      throw new ForbiddenException('You can only cancel your own parcels');
    }

    this.assertTransitionAllowed(parcel.status, ParcelStatus.CANCELLED);

    parcel.status = ParcelStatus.CANCELLED;
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(
      parcel,
      ParcelStatus.CANCELLED,
      sender,
      'Cancelled by sender',
    );

    return this.refreshAndIndex(trackingId);
  }

  async confirmDelivery(trackingId: string, receiver: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.receiver.id !== receiver.id) {
      throw new ForbiddenException('You can only confirm your own parcels');
    }

    this.assertTransitionAllowed(parcel.status, ParcelStatus.DELIVERED);

    parcel.status = ParcelStatus.DELIVERED;
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(
      parcel,
      ParcelStatus.DELIVERED,
      receiver,
      'Delivery confirmed by receiver',
    );

    return this.refreshAndIndex(trackingId);
  }

  async blockParcel(trackingId: string, admin: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);
    parcel.isBlocked = true;
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(
      parcel,
      parcel.status,
      admin,
      'Parcel blocked by admin',
    );

    return this.refreshAndIndex(trackingId);
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
    return this.findPage(query, {
      receiver: { id: receiver.id },
      status: Not(In(CLOSED_STATUSES)),
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

    if (parcel.status === ParcelStatus.CANCELLED) {
      throw new BadRequestException('Cannot deliver a cancelled parcel');
    }

    if (parcel.codAmount > 0 && !payload.codCollected) {
      throw new BadRequestException(
        `This parcel is cash on delivery (${parcel.codAmount}) — confirm collection with codCollected`,
      );
    }

    parcel.deliveryProofImages = payload.images;
    parcel.deliveryProofNote = payload.note ?? null;
    parcel.receivedBy = payload.receivedBy ?? parcel.receiverName;
    parcel.isCodCollected = payload.codCollected ?? parcel.isCodCollected;

    // Proof is only meaningful alongside the transition it evidences.
    if (parcel.status !== ParcelStatus.DELIVERED) {
      this.assertTransitionAllowed(parcel.status, ParcelStatus.DELIVERED);
      parcel.status = ParcelStatus.DELIVERED;
    }

    parcel.deliveredAt = new Date();
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(
      parcel,
      ParcelStatus.DELIVERED,
      actor,
      payload.note ?? `Delivered to ${parcel.receivedBy}`,
    );

    return this.refreshAndIndex(trackingId);
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

  // ─── Internals ────────────────────────────────────────────────────────────

  /**
   * Receivers are addressed by id when the sender picked an existing account,
   * and by email otherwise — in which case a placeholder account is created.
   */
  private async resolveReceiver(
    payload: CreateParcelDto,
  ): Promise<{ user: User; created: boolean }> {
    if (payload.receiverId) {
      return {
        user: await this.userService.findEntityByIdOrFail(payload.receiverId),
        created: false,
      };
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
    const where = query.search
      ? searchable.map((field) => ({
          ...filters,
          [field]: ILike(`%${query.search}%`),
        }))
      : filters;

    const [data, total] = await this.parcelRepository.findAndCount({
      where: where as never,
      relations: PARCEL_RELATIONS,
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
   * Single exit point for every mutation: re-read with relations, re-index for
   * search, and email whoever cares. Both side effects swallow their own
   * failures so neither can undo a committed write.
   */
  private async refreshAndIndex(trackingId: string): Promise<Parcel> {
    const updatedParcel = await this.getParcelWithLogs(trackingId);
    await this.triggerParcelIndex(updatedParcel);
    await this.notifications.notifyStatusChange(updatedParcel);
    return updatedParcel;
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

  private async addStatusLog(
    parcel: Parcel,
    status: ParcelStatus,
    user: User,
    note?: string,
  ): Promise<void> {
    const log = this.statusLogRepository.create({
      parcel,
      status,
      changedBy: user,
      note,
    });
    await this.statusLogRepository.save(log);
  }

  /**
   * Fire-and-forget re-index. This used to POST to `/api/rag/index/parcel`
   * over HTTP, which only worked because that route was unauthenticated —
   * guarding it turned the self-call into a 401. Calling `RagService`
   * directly removes the hole along with a network hop, and the catch keeps a
   * failing vector store from failing the parcel write.
   */
  private async triggerParcelIndex(parcel: Parcel): Promise<void> {
    const latestNote = parcel.statusLogs?.[parcel.statusLogs.length - 1]?.note;

    const document: ParcelIndexDocument = {
      id: parcel.id,
      trackingCode: parcel.trackingId,
      status: parcel.status,
      origin: parcel.pickupAddress,
      destination: parcel.deliveryAddress,
      recipientName: parcel.receiverName,
      updatedAt: parcel.updatedAt.toISOString(),
      notes: latestNote,
    };

    try {
      await this.ragService.indexParcel(document);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `RAG indexing failed for ${parcel.trackingId}: ${message}`,
      );
    }
  }

  private generateTrackingId(): string {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `TRK-${Date.now().toString(36).toUpperCase()}${suffix}`;
  }
}
