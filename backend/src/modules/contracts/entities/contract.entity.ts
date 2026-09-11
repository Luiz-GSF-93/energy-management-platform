import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';

@Entity('contracts')
export class Contract {
  // ==================== ID E IDENTIFICAÇÃO ====================
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  contractNumber: string;

  @Column({ type: 'varchar', length: 255 })
  contractTitle: string;

  @Column({ type: 'text', nullable: true })
  observations: string;

  // ==================== PARTES DO CONTRATO ====================
  @Column({ type: 'uuid', nullable: true })
  customerId: string;

  @Column({ type: 'varchar', length: 255 })
  supplierName: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  supplierCnpj: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  distributorName: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  distributorCnpj: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  supplierContact: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  supplierEmail: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  supplierPhone: string;

  // ==================== ENERGIA E VOLUME ====================
  @Column({ type: 'decimal', precision: 15, scale: 4 })
  contractedMwhAnnual: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  seasonality: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  flexibility: number;

  @Column({ type: 'decimal', precision: 15, scale: 4 })
  demandKw: number;

  @Column({ type: 'simple-array', nullable: true })
  consumerUnits: string[];

  // ==================== PRECIFICAÇÃO ====================
  @Column({ type: 'decimal', precision: 12, scale: 6 })
  pricePerMwh: number;

  @Column({ type: 'decimal', precision: 12, scale: 6 })
  regulatedPrice: number;

  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true })
  tusdComponent: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  icmsPercentage: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monthlyFee: number;

  // ==================== REAJUSTES ====================
  @Column({ type: 'varchar', length: 50, nullable: true })
  adjustmentIndex: string;

  @Column({ type: 'date', nullable: true })
  adjustmentDate: Date;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  adjustmentPercentage: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  adjustmentCap: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  adjustmentFloor: number;

  // ==================== FLEXIBILIDADE ====================
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  variationAllowed: number;

  @Column({ type: 'boolean', default: false })
  takeOrPayEnabled: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  penaltyPercentage: number;

  @Column({ type: 'int', nullable: true })
  noticeTermDays: number;

  // ==================== CONDIÇÕES COMERCIAIS ====================
  @Column({ type: 'varchar', length: 50 })
  billingFrequency: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  paymentMethod: string;

  @Column({ type: 'int', nullable: true })
  dueCardancyDays: number;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  currency: string;

  // ==================== CONFIGURAÇÃO ====================
  @Column({ type: 'varchar', length: 50 })
  contractType: string;

  @Column({
    type: 'enum',
    enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'],
    default: 'ACTIVE',
  })
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TERMINATED';

  @Column({ type: 'varchar', length: 50 })
  purchaseModality: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  commissionPercentage: number;

  // ==================== TIMESTAMPS ====================
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string;
}
