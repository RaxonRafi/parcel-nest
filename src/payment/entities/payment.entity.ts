import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../../common/utils/numeric.transformer';
import { Parcel } from '../../parcel/entities/parcel.entity';
import { User } from '../../user/entities/user.entity';
import { PaymentProvider, PaymentState } from '../types/payment.types';

/**
 * One attempt to pay a parcel's delivery fee online. A parcel may collect
 * several — an abandoned checkout, then a successful one.
 */
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_payments_parcelId')
  @ManyToOne(() => Parcel, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parcelId' })
  parcel!: Parcel;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payerId' })
  payer!: User | null;

  @Column({ type: 'varchar', length: 16 })
  provider!: PaymentProvider;

  /** Our id for the attempt, sent to the gateway and echoed back by it. */
  @Column({ type: 'varchar', length: 40, unique: true })
  tranId!: string;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
  })
  amount!: number;

  @Column({ type: 'varchar', length: 3, default: 'BDT' })
  currency!: string;

  @Column({ type: 'varchar', length: 16, default: PaymentState.INITIATED })
  status!: PaymentState;

  /** The gateway's validation id — what a payment is re-checked by. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  valId!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  bankTranId!: string | null;

  /** "BKASH-BKash", "VISA-Dutch Bangla" and the like. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  cardType!: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
