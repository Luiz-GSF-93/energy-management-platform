import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity('contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  contractNumber: string;

  @Column({ type: 'uuid', nullable: true })
  customerId: string;

  @Column({ type: 'varchar', length: 255 })
  contractTitle: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monthlyFee: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  commissionPercentage: number;

  @Column({ type: 'date' })
  startDate: Date;

  @Column({ type: 'date', nullable: true })
  endDate: Date;

  @Column({ type: 'enum', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'], default: 'ACTIVE' })
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TERMINATED';

  @Column({ type: 'varchar', length: 50 })
  contractType: string;

  @Column({ type: 'text', nullable: true })
  terms: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
