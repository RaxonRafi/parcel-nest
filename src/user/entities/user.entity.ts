import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AuthProvider } from './auth-provider.entity';
import { IsActive, Role } from '../types/user.types';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ nullable: true })
  password!: string;

  @Column({ type: 'varchar', length: 32, default: Role.SENDER })
  role!: Role;

  @Column({ nullable: true })
  phone!: string;

  @Column({ nullable: true })
  picture!: string;

  @Column({ nullable: true })
  address!: string;

  @Column({ default: false })
  isDeleted!: boolean;

  @Column({ type: 'varchar', length: 32, default: IsActive.ACTIVE })
  isActive!: IsActive;

  @Column({ default: false })
  isVerified!: boolean;

  @Column({ nullable: true, unique: true })
  nidNumber!: string;

  @Column({ type: 'simple-array', default: '' })
  nidImage!: string[];

  /** Parcel update emails. Account and security mail is sent regardless. */
  @Column({ default: true })
  emailNotifications!: boolean;

  /** Wrong passwords since the last successful sign-in. Never leaves the API. */
  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  /** Sign-in is refused until this passes. Never leaves the API. */
  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @OneToMany(() => AuthProvider, (auth) => auth.user, {
    cascade: true,
    eager: true,
  })
  auths!: AuthProvider[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
