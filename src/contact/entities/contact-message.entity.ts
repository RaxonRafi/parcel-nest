import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A message from the public contact form. The email to support is a
 * convenience; this row is the record, so nothing is lost when mail is down.
 */
@Entity('contact_messages')
export class ContactMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 16 })
  topic!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  trackingId!: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
