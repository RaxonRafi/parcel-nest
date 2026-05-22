import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToMany,
  } from 'typeorm';
import { AuthProvider } from './auth-provider.entity';
import { IsActive, Role } from './user.interface';
  
  
  @Entity('users')
  export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;
  
    @Column()
    name: string;
  
    @Column({ unique: true })
    email: string;
  
    @Column({ nullable: true })
    password: string;
  
    @Column({ type: 'varchar', length: 32, default: Role.SENDER })
    role: Role;
  
    @Column({ nullable: true })
    phone: string;
  
    @Column({ nullable: true })
    picture: string;
  
    @Column({ nullable: true })
    address: string;
  
    @Column({ default: false })
    isDeleted: boolean;
  
    @Column({ type: 'varchar', length: 32, default: IsActive.ACTIVE })
    isActive: IsActive;
  
    @Column({ default: false })
    isVerified: boolean;
  
    @Column({ nullable: true, unique: true })
    nidNumber: string;
  
    @Column({ type: 'simple-array', default: '' })
    nidImage: string[];
  
    @OneToMany(() => AuthProvider, (auth) => auth.user, {
      cascade: true,
      eager: true,
    })
    auths: AuthProvider[];
  
    @CreateDateColumn()
    createdAt: Date;
  
    @UpdateDateColumn()
    updatedAt: Date;
  }