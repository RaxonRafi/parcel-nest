import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { IsActive, Role } from '../user/user.interface';
import { CreateParcelDto } from './dto/create-parcel.dto';
import { UpdateParcelStatusDto } from './dto/update-parcel-status.dto';
import { ParcelStatusLog } from './parcel-status-log.entity';
import { Parcel } from './parcel.entity';
import { ParcelStatus } from './parcel.interface';

@Injectable()
export class ParcelService {
  private readonly logger = new Logger(ParcelService.name);

  constructor(
    @InjectRepository(Parcel)
    private readonly parcelRepository: Repository<Parcel>,
    @InjectRepository(ParcelStatusLog)
    private readonly statusLogRepository: Repository<ParcelStatusLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

async create(sender: User, payload: CreateParcelDto): Promise<Parcel> {
  if (sender.role !== Role.SENDER && sender.role !== Role.ADMIN) {
    throw new ForbiddenException('Only senders can create parcels');
  }

  let receiver = await this.userRepository.findOne({
    where: { email: payload.receiverEmail, isDeleted: false },
  });

  if (!receiver) {
    receiver = this.userRepository.create({
      name: payload.receiverName,
      email: payload.receiverEmail,
      phone: payload.receiverPhone,
      role: Role.RECEIVER,
      isVerified: false,
      isActive: IsActive.ACTIVE,
      isDeleted: false,
    });
    receiver = await this.userRepository.save(receiver);
  }

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
    const updatedParcel = await this.getParcelWithLogs(trackingId);
    await this.triggerParcelIndex(updatedParcel);

    return updatedParcel;
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
    const updatedParcel = await this.getParcelWithLogs(trackingId);
    await this.triggerParcelIndex(updatedParcel);

    return updatedParcel;
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
    const updatedParcel = await this.getParcelWithLogs(trackingId);
    await this.triggerParcelIndex(updatedParcel);

    return updatedParcel;
  }

  async blockParcel(trackingId: string, admin: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);
    parcel.isBlocked = true;
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(parcel, parcel.status, admin, 'Parcel blocked by admin');
    const updatedParcel = await this.getParcelWithLogs(trackingId);
    await this.triggerParcelIndex(updatedParcel);

    return updatedParcel;
  }

  async getMyParcels(sender: User): Promise<Parcel[]> {
    return this.parcelRepository.find({
      where: { sender: { id: sender.id } },
      relations: ['sender', 'receiver', 'statusLogs', 'statusLogs.changedBy'],
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
      relations: ['sender', 'receiver', 'statusLogs', 'statusLogs.changedBy'],
      order: { createdAt: 'DESC' },
    });
  }

  async getByTrackingId(trackingId: string): Promise<Parcel> {
    return this.getParcelWithLogs(trackingId);
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
      relations: ['sender', 'receiver', 'statusLogs', 'statusLogs.changedBy'],
    });

    if (parcel?.statusLogs) {
      parcel.statusLogs.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
    }

    if (!parcel) {
      throw new NotFoundException('Parcel not found');
    }

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

  private async triggerParcelIndex(parcel: Parcel): Promise<void> {
    const latestNote = parcel.statusLogs?.[parcel.statusLogs.length - 1]?.note;
    const baseUrl =
      process.env.INTERNAL_API_BASE_URL ??
      process.env.APP_URL ??
      `http://localhost:${process.env.PORT ?? 3000}`;

    try {
      const response = await fetch(`${baseUrl}/api/rag/index/parcel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: parcel.id,
          trackingCode: parcel.trackingId,
          status: parcel.status,
          origin: parcel.pickupAddress,
          destination: parcel.deliveryAddress,
          recipientName: parcel.receiverName,
          updatedAt: parcel.updatedAt.toISOString(),
          notes: latestNote,
        }),
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
