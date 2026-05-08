import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./user.entity";
import { AuthProviderType } from "./user.interface";


@Entity('auth_providers')
export class AuthProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({type:'enum', enum: AuthProviderType})
  provider: AuthProviderType;

  @Column()
  providerId: string;

  @ManyToOne(() => User, (user) => user.auths, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}