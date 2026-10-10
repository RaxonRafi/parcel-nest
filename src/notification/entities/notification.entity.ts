import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

/**
 * One notification for one user. The same event reaches several people — the
 * sender, the receiver, the courier, every admin — and each gets their own
 * row, because whether it has been read is theirs alone.
 */
@Entity('notifications')
@Index(['user', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** A `RealtimeNotificationType`, kept as text so new kinds need no migration. */
  @Column({ type: 'varchar', length: 32 })
  type!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  trackingId!: string | null;

  /** The parcel's status when this was raised, for the icon and colour. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  status!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
