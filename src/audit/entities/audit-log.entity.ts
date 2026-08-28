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
import { AuditAction, AuditTargetType } from '../types/audit.types';

/**
 * Append-only record of privileged actions. Parcels already had a status log;
 * this covers everything else an admin can do — blocking accounts, approving
 * couriers, reassigning deliveries — none of which left a trace before.
 *
 * `actor` is nullable and `SET NULL` on delete: the point of an audit trail is
 * that removing the account does not erase what it did.
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;

  /** Kept alongside the relation so the trail survives the account. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail: string | null;

  @Index()
  @Column({ type: 'varchar', length: 48 })
  action: AuditAction;

  @Column({ type: 'varchar', length: 16 })
  targetType: AuditTargetType;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  targetId: string;

  /** Human-readable summary, so a log line is legible without joins. */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** Before/after values and anything else worth keeping. */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
