import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum LogLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

@Entity('extraction_logs')
@Index(['extractionId'])
@Index(['level'])
@Index(['createdAt'])
export class ExtractionLog {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  extractionId: string;

  @Column({ type: 'character varying', enum: LogLevel })
  level: LogLevel;

  @Column('text')
  message: string;

  @Column({ nullable: true, type: 'jsonb' })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
