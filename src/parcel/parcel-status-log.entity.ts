import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Parcel } from './parcel.entity';
import { ParcelStatus } from './parcel.interface';

@Entity('parcel_status_logs')
export class ParcelStatusLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Parcel, (parcel) => parcel.statusLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parcelId' })
  parcel: Parcel;

  @Column({ type: 'varchar', length: 32 })
  status: ParcelStatus;

  @Column({ type: 'text', nullable: true })
  note: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changedById' })
  changedBy: User;

  @CreateDateColumn()
  createdAt: Date;
}
