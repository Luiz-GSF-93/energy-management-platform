import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Fee } from '../../management-fees/entities/fee.entity';

@Entity('approvals')
export class Approval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Fee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fee_id' })
  fee: Fee;

  @Column({ type: 'varchar', length: 255 })
  approverName: string;

  @Column({ type: 'varchar', length: 255 })
  approverEmail: string;

  @Column({ type: 'enum', enum: ['APPROVED', 'REJECTED', 'PENDING_REVIEW'], default: 'PENDING_REVIEW' })
  status: 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW';

  @Column({ type: 'text', nullable: true })
  comments: string;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
