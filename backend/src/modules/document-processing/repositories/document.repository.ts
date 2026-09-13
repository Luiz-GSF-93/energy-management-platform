import { Injectable } from '@nestjs/common';
import { DocumentEntity } from '../entities/document.entity';

@Injectable()
export class DocumentRepository {
  private documents: DocumentEntity[] = [];

  async save(document: DocumentEntity): Promise<DocumentEntity> {
    this.documents.push(document);
    return document;
  }

  async findById(id: string): Promise<DocumentEntity | null> {
    return this.documents.find(d => d.id === id) || null;
  }

  async findByOrganization(organizationId: string): Promise<DocumentEntity[]> {
    return this.documents.filter(d => d.organizationId === organizationId);
  }

  async findAll(): Promise<DocumentEntity[]> {
    return this.documents;
  }
}
