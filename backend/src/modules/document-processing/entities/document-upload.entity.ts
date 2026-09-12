import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DocumentStatus } from '../enums/document-status.enum';

@Entity('document_uploads')
@Index(['organizationId'])
@Index(['status'])
@Index(['uploadedAt'])
export class DocumentUpload {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  organizationId: string;

  @Column('uuid')
  uploadedByUserId: string;

  @Column('character varying')
  filename: string;

  @Column('character varying')
  storagePath: string;

  @Column('character varying')
  mimeType: string;

  @Column('bigint')
  fileSize: number;

  @Column({
    type: 'character varying',
    enum: DocumentStatus,
    default: DocumentStatus.UPLOADED,
  })
  status: DocumentStatus;

  @CreateDateColumn()
  uploadedAt: Date;

  @Column({ nullable: true })
  processedAt: Date;
}
