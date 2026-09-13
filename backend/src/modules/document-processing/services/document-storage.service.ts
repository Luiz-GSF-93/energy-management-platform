import { Injectable } from '@nestjs/common';
import { DocumentRepository } from '../repositories/document.repository';
import { DocumentEntity } from '../entities/document.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentStorageService {
  constructor(private documentRepository: DocumentRepository) {}

  async saveDocument(data: Partial<DocumentEntity>): Promise<DocumentEntity> {
    const document: DocumentEntity = {
      id: uuidv4(),
      status: 'COMPLETED',
      createdAt: new Date(),
      updatedAt: new Date(),
      totalAmount: data.totalAmount || 0,
      clientName: data.clientName || '',
      consumptionKwh: data.consumptionKwh || 0,
      demandKw: data.demandKw || 0,
      ...data,
    } as DocumentEntity;

    return await this.documentRepository.save(document);
  }

  async getDocument(id: string): Promise<DocumentEntity | null> {
    return await this.documentRepository.findById(id);
  }

  async getDocumentsByOrganization(organizationId: string): Promise<DocumentEntity[]> {
    return await this.documentRepository.findByOrganization(organizationId);
  }

  async getAllDocuments(): Promise<DocumentEntity[]> {
    return await this.documentRepository.findAll();
  }
}
