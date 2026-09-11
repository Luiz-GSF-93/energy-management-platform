import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Contract } from '../../contracts/entities/contract.entity';

@Entity('fees')
export class Fee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'date' })
  referenceMonth: Date;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  baseFee: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  energySavings: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  savingsPercentage: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  commission: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalFee: number;

  @Column({ type: 'enum', enum: ['PENDING', 'APPROVED', 'REJECTED', 'PAID'], default: 'PENDING' })
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
