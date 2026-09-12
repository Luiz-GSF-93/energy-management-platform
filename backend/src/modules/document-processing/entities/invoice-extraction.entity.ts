import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ExtractionStatus, ConfidenceLevel } from '../enums/extraction-status.enum';

@Entity('invoice_extractions')
@Index(['documentId'])
@Index(['organizationId'])
@Index(['extractionStatus'])
@Index(['confidenceLevel'])
@Index(['processingStartedAt'])
export class InvoiceExtraction {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  documentId: string;

  @Column('text')
  organizationId: string;

  @Column('character varying')
  processor: string;

  @Column('character varying')
  processorVersion: string;

  @Column({
    type: 'character varying',
    enum: ExtractionStatus,
    default: ExtractionStatus.PENDING,
  })
  extractionStatus: ExtractionStatus;

  @Column({
    type: 'character varying',
    enum: ConfidenceLevel,
  })
  confidenceLevel: ConfidenceLevel;

  @Column('numeric', { precision: 5, scale: 2 })
  confidenceScore: number;

  @Column('text')
  rawText: string;

  @Column('jsonb', { default: {} })
  structuredData: Record<string, any>;

  @Column({ nullable: true })
  detectedDistributor: string;

  @Column({ nullable: true, type: 'text' })
  validationNotes: string;

  @CreateDateColumn()
  processingStartedAt: Date;

  @Column({ nullable: true })
  processingFinishedAt: Date;

  @Column({ nullable: true })
  approvedAt: Date;

  @Column({ nullable: true, type: 'uuid' })
  approvedByUserId: string;

  @Column({ nullable: true, type: 'text' })
  linkedInvoiceId: string;
}
