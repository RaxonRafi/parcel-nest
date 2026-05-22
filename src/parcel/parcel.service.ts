import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { Role } from '../user/user.interface';
import { CreateParcelDto } from './dto/create-parcel.dto';
import { UpdateParcelStatusDto } from './dto/update-parcel-status.dto';
import { ParcelStatusLog } from './parcel-status-log.entity';
import { Parcel } from './parcel.entity';
import { ParcelStatus } from './parcel.interface';

@Injectable()
export class ParcelService {
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

    const receiver = await this.userRepository.findOne({
      where: { id: payload.receiverId, isDeleted: false },
    });

    if (!receiver) {
      throw new NotFoundException('Receiver not found');
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

    return this.parcelRepository.save(parcel);
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

    return this.getParcelWithLogs(trackingId);
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

    return this.getParcelWithLogs(trackingId);
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

    return this.getParcelWithLogs(trackingId);
  }

  async blockParcel(trackingId: string, admin: User): Promise<Parcel> {
    const parcel = await this.findByTrackingIdOrFail(trackingId);
    parcel.isBlocked = true;
    await this.parcelRepository.save(parcel);
    await this.addStatusLog(parcel, parcel.status, admin, 'Parcel blocked by admin');
    return this.getParcelWithLogs(trackingId);
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

  private generateTrackingId(): string {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `TRK-${Date.now().toString(36).toUpperCase()}${suffix}`;
  }
}
