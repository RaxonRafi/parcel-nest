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
import {
  DeliveryFailureReason,
  DeliveryZone,
  ParcelStatus,
  PaymentStatus,
  ServiceTier,
} from '../types/parcel.types';
import { FeeBreakdown } from '../utils/pricing.util';

@Entity('parcels')
export class Parcel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  trackingId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'senderId' })
  sender!: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'receiverId' })
  receiver!: User;

  /**
   * The approved courier carrying this parcel. Null until an admin assigns
   * one, and nulled again if that user is removed.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deliveryPersonnelId' })
  deliveryPersonnel!: User | null;

  @Column()
  senderName!: string;

  @Column()
  receiverName!: string;

  @Column({ nullable: true })
  senderPhone!: string;

  @Column({ nullable: true })
  receiverPhone!: string;

  @Column({ type: 'text' })
  pickupAddress!: string;

  @Column({ type: 'text' })
  deliveryAddress!: string;

  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({ type: 'varchar', length: 32, default: ParcelStatus.PENDING })
  status!: ParcelStatus;

  @Column({ default: false })
  isBlocked!: boolean;

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
  weightKg!: number;

  /** Computed server-side from weight — never taken from the request. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  deliveryFee!: number;

  /**
   * How `deliveryFee` was arrived at, frozen at booking. Stored rather than
   * recomputed because the rates are configuration and can change afterwards.
   * Null on parcels booked before this column existed.
   */
  @Column({ type: 'jsonb', nullable: true })
  feeBreakdown!: FeeBreakdown | null;

  /** Cash to collect from the receiver on handover. 0 means prepaid. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  codAmount!: number;

  @Column({ default: false })
  isCodCollected!: boolean;

  /**
   * How the fee is settled — see `PaymentStatus`. Follows `codAmount` until
   * the sender pays online, after which the price is frozen.
   */
  @Column({ type: 'varchar', length: 16, default: PaymentStatus.UNPAID })
  paymentStatus!: PaymentStatus;

  /** Charged when the parcel reached RETURNED_TO_SENDER; null otherwise. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  returnFee!: number | null;

  // ── Route and schedule ────────────────────────────────────────────────────
  // Zones default to inside Dhaka, which prices exactly as a parcel booked
  // before zones existed did.

  @Column({ type: 'varchar', length: 16, default: DeliveryZone.DHAKA_CITY })
  pickupZone!: DeliveryZone;

  @Column({ type: 'varchar', length: 16, default: DeliveryZone.DHAKA_CITY })
  deliveryZone!: DeliveryZone;

  @Column({ type: 'varchar', length: 16, default: ServiceTier.STANDARD })
  serviceTier!: ServiceTier;

  /** When the sender wants the courier to come. Both null without a slot. */
  @Column({ type: 'timestamptz', nullable: true })
  pickupWindowStart!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pickupWindowEnd!: Date | null;

  /** Recomputed on edit and moved to the new day on a reschedule. */
  @Column({ type: 'timestamptz', nullable: true })
  estimatedDeliveryAt!: Date | null;

  // ── Delivery attempts ─────────────────────────────────────────────────────

  @Column({ type: 'int', default: 0 })
  deliveryAttempts!: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  lastFailureReason!: DeliveryFailureReason | null;

  @Column({ type: 'timestamptz', nullable: true })
  rescheduledFor!: Date | null;

  /**
   * Hash of the code the receiver gives the courier at the door. A fresh code
   * is issued each time the parcel goes out for delivery. Never leaves the API.
   */
  @Column({ type: 'varchar', length: 128, nullable: true, select: false })
  deliveryCodeHash!: string | null;

  /** Wrong codes entered against the current one. Never leaves the API. */
  @Column({ type: 'int', default: 0, select: false })
  deliveryCodeAttempts!: number;

  // ── Proof of delivery ─────────────────────────────────────────────────────

  @Column({ type: 'simple-array', default: '' })
  deliveryProofImages!: string[];

  @Column({ type: 'text', nullable: true })
  deliveryProofNote!: string | null;

  /** Who actually took the parcel — often not the named receiver. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  receivedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @OneToMany(() => ParcelStatusLog, (log) => log.parcel, { cascade: true })
  statusLogs!: ParcelStatusLog[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
