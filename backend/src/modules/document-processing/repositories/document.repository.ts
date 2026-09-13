import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { DocumentEntity } from '../entities/document.entity';

@Injectable()
export class DocumentRepository extends Repository<DocumentEntity> {
  constructor(private dataSource: DataSource) {
    super(DocumentEntity, dataSource.createEntityManager());
  }

  async findByInvoiceNumber(invoiceNumber: string, organizationId: string): Promise<DocumentEntity | null> {
    return this.findOne({
      where: { invoiceNumber, organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByOrganization(organizationId: string, limit: number = 50): Promise<DocumentEntity[]> {
    return this.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findValidInvoices(organizationId: string): Promise<DocumentEntity[]> {
    return this.find({
      where: { organizationId, isValidInvoice: true },
      order: { createdAt: 'DESC' },
    });
  }
}
