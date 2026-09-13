import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('documents')
@Index(['organizationId', 'createdAt'])
@Index(['invoiceNumber'])
export class DocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @Column({ type: 'varchar', length: 50 })
  mimeType: string;

  @Column({ type: 'integer' })
  fileSize: number;

  @Column({ type: 'text' })
  filePath: string;

  @Column({ type: 'text', nullable: true })
  extractedText: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceNumber: string;

  @Column({ type: 'date', nullable: true })
  emissionDate: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  referenceMonth: string;

  @Column({ type: 'date', nullable: true })
  dueDate: string;

  @Column({ type: 'text', nullable: true })
  clientName: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  clientCnpj: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  distributorName: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  consumerUnit: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  consumptionKwh: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  demandKw: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalAmount: number;

  @Column({ type: 'varchar', length: 3, default: 'BRL' })
  currency: string;

  @Column({ type: 'boolean', default: false })
  isValidInvoice: boolean;

  @Column({ type: 'integer', default: 0 })
  validationScore: number;

  @Column({ type: 'text', nullable: true })
  validationErrors: string;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  status: string;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'varchar', length: 100 })
  organizationId: string;

  @Column({ type: 'varchar', length: 100, default: 'default' })
  empresaId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date;
}
