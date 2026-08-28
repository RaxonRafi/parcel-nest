import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { ParcelStatusLog } from './parcel-status-log.entity';
import { ParcelStatus } from '../types/parcel.types';

@Entity('parcels')
export class Parcel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  trackingId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'senderId' })
  sender: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'receiverId' })
  receiver: User;

  /**
   * The approved courier carrying this parcel. Null until an admin assigns
   * one, and nulled again if that user is removed.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deliveryPersonnelId' })
  deliveryPersonnel: User | null;

  @Column()
  senderName: string;

  @Column()
  receiverName: string;

  @Column({ nullable: true })
  senderPhone: string;

  @Column({ nullable: true })
  receiverPhone: string;

  @Column({ type: 'text' })
  pickupAddress: string;

  @Column({ type: 'text' })
  deliveryAddress: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 32, default: ParcelStatus.PENDING })
  status: ParcelStatus;

  @Column({ default: false })
  isBlocked: boolean;

  @OneToMany(() => ParcelStatusLog, (log) => log.parcel, { cascade: true })
  statusLogs: ParcelStatusLog[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
