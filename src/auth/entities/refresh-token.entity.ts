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
 * Why a session ended. `rotated` is the one that matters: a rotated token
 * presented again is evidence the chain was copied.
 */
export type RevokeReason = 'rotated' | 'logout' | 'reuse' | 'security';

/**
 * One row per issued refresh token, so a session can actually be ended.
 *
 * Only the SHA-256 of the token is stored: a leaked database gives an attacker
 * no usable tokens. Access tokens stay stateless and expire on their own — at
 * a 15 minute TTL that is the window a revoked session stays alive.
 */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  /**
   * Shared by every token in one rotation chain — one sign-in on one device.
   * Null on rows written before families existed.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  familyId!: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /** Set on logout, on rotation, and on password reset. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  revokedReason!: RevokeReason | null;

  /** Shown back to the user so they can recognise the device. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
