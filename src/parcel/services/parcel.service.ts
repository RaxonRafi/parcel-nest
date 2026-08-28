import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { UserService } from '../../user/services/user.service';
import { Role } from '../../user/types/user.types';
import { CreateParcelDto } from '../dto/create-parcel.dto';
import { UpdateParcelStatusDto } from '../dto/update-parcel-status.dto';
import { ParcelStatusLog } from '../entities/parcel-status-log.entity';
import { Parcel } from '../entities/parcel.entity';
import {
  ParcelIndexDocument,
  ParcelStats,
  ParcelStatus,
} from '../types/parcel.types';

const PARCEL_RELATIONS = [
  'sender',
  'receiver',
  'statusLogs',
  'statusLogs.changedBy',
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
  ) {}

  async create(sender: User, payload: CreateParcelDto): Promise<Parcel> {
    if (sender.role !== Role.SENDER && sender.role !== Role.ADMIN) {
      throw new ForbiddenException('Only senders can create parcels');
    }

    const receiver = await this.resolveReceiver(payload);

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

    return freshParcel;
  }

  async updateStatus(
    trackingId: string,
    payload: UpdateParcelStatusDto,
    admin: User,
  ): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.isBlocked) {
      throw new BadRequestException('Parcel is blocked');
    }

    if (parcel.status === ParcelStatus.CANCELLED) {
      throw new BadRequestException('Cannot update a cancelled parcel');
    }

    parcel.status = payload.status;
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(parcel, payload.status, admin, payload.note);

    return this.refreshAndIndex(trackingId);
  }

  async cancelParcel(trackingId: string, sender: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);

    if (parcel.sender.id !== sender.id) {
      throw new ForbiddenException('You can only cancel your own parcels');
    }

    if (parcel.status === ParcelStatus.DELIVERED) {
      throw new BadRequestException('Delivered parcels cannot be cancelled');
    }

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

  async getMyParcels(sender: User): Promise<Parcel[]> {
    return this.parcelRepository.find({
      where: { sender: { id: sender.id } },
      relations: PARCEL_RELATIONS,
      order: { createdAt: 'DESC' },
    });
  }

  async getIncomingParcels(receiver: User): Promise<Parcel[]> {
    return this.parcelRepository.find({
      where: {
        receiver: { id: receiver.id },
        status: ParcelStatus.IN_TRANSIT,
      },
      relations: ['sender', 'receiver', 'statusLogs'],
      order: { createdAt: 'DESC' },
    });
  }

  async getDeliveryHistory(receiver: User): Promise<Parcel[]> {
    return this.parcelRepository.find({
      where: {
        receiver: { id: receiver.id },
        status: ParcelStatus.DELIVERED,
      },
      relations: ['sender', 'receiver', 'statusLogs'],
      order: { updatedAt: 'DESC' },
    });
  }

  async getAllParcels(): Promise<Parcel[]> {
    return this.parcelRepository.find({
      relations: PARCEL_RELATIONS,
      order: { createdAt: 'DESC' },
    });
  }

  async getByTrackingId(trackingId: string): Promise<Parcel> {
    return this.getParcelWithLogs(trackingId);
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
  private async resolveReceiver(payload: CreateParcelDto): Promise<User> {
    if (payload.receiverId) {
      return this.userService.findEntityByIdOrFail(payload.receiverId);
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

  private async refreshAndIndex(trackingId: string): Promise<Parcel> {
    const updatedParcel = await this.getParcelWithLogs(trackingId);
    await this.triggerParcelIndex(updatedParcel);
    return updatedParcel;
  }

  private async findByTrackingIdOrFail(trackingId: string): Promise<Parcel> {
    const parcel = await this.parcelRepository.findOne({
      where: { trackingId },
      relations: ['sender', 'receiver'],
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

    return parcel;
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
   * Fire-and-forget re-index. Kept as an HTTP call to /api/rag/index/parcel so
   * parcel writes stay usable when the RAG providers are not configured.
   */
  private async triggerParcelIndex(parcel: Parcel): Promise<void> {
    const latestNote = parcel.statusLogs?.[parcel.statusLogs.length - 1]?.note;
    const baseUrl =
      process.env.INTERNAL_API_BASE_URL ??
      process.env.APP_URL ??
      `http://localhost:${process.env.PORT ?? 3000}`;

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
      const response = await fetch(`${baseUrl}/api/rag/index/parcel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(document),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.warn(
          `RAG indexing failed for ${parcel.trackingId}: ${response.status} ${errorBody}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `RAG indexing request failed for ${parcel.trackingId}: ${message}`,
      );
    }
  }

  private generateTrackingId(): string {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `TRK-${Date.now().toString(36).toUpperCase()}${suffix}`;
  }
}
