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
import { numericTransformer } from '../../common/utils/numeric.transformer';
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

  // ── Pricing ───────────────────────────────────────────────────────────────
  // `numeric` comes back from pg as a string; the transformer keeps the entity
  // numeric so callers never have to remember to parse it.

  @Column({
    type: 'numeric',
    precision: 8,
    scale: 3,
    default: 1,
    transformer: numericTransformer,
  })
  weightKg: number;

  /** Computed server-side from weight — never taken from the request. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  deliveryFee: number;

  /** Cash to collect from the receiver on handover. 0 means prepaid. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  codAmount: number;

  @Column({ default: false })
  isCodCollected: boolean;

  // ── Proof of delivery ─────────────────────────────────────────────────────

  @Column({ type: 'simple-array', default: '' })
  deliveryProofImages: string[];

  @Column({ type: 'text', nullable: true })
  deliveryProofNote: string | null;

  /** Who actually took the parcel — often not the named receiver. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  receivedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @OneToMany(() => ParcelStatusLog, (log) => log.parcel, { cascade: true })
  statusLogs: ParcelStatusLog[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
