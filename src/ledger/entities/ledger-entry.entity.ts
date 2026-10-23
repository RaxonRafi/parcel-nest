import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../common/utils/numeric.transformer';
import { Parcel } from '../../parcel/entities/parcel.entity';
import { User } from '../../user/entities/user.entity';
import { LedgerAccountType, LedgerEntryType } from '../types/ledger.types';

/**
 * One movement of money. Rows are only ever inserted: a mistake is corrected
 * by a further entry, never by editing one, so a balance can always be
 * explained line by line.
 */
@Entity('ledger_entries')
@Index('IDX_ledger_entries_account', ['accountType', 'account', 'createdAt'])
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  accountType!: LedgerAccountType;

  /** Users are only ever soft-deleted, so this never dangles. */
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'accountId' })
  account!: User;

  @Column({ type: 'varchar', length: 32 })
  type!: LedgerEntryType;

  /** Signed, in BDT — see `LedgerEntryType` for which way each type goes. */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  amount!: number;

  @ManyToOne(() => Parcel, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parcelId' })
  parcel!: Parcel | null;

  /** Kept beside the relation so a statement reads without a join. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  trackingId!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** A payout's bank or bKash reference, or a payment's transaction id. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  reference!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy!: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
