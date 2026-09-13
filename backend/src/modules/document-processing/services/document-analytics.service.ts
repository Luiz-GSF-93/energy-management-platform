import { Injectable } from '@nestjs/common';
import { DocumentStorageService } from './document-storage.service';

@Injectable()
export class DocumentAnalyticsService {
  constructor(private documentStorageService: DocumentStorageService) {}

  async getDashboardStats(organizationId?: string) {
    const documents = organizationId
      ? await this.documentStorageService.getDocumentsByOrganization(organizationId)
      : await this.documentStorageService.getAllDocuments();

    const stats = {
      totalDocuments: documents.length,
      totalProcessed: documents.filter(d => d.status === 'COMPLETED').length,
      totalPending: documents.filter(d => d.status === 'PENDING').length,
      totalErrors: documents.filter(d => d.status === 'ERROR').length,
      totalSize: documents.reduce((sum, d) => sum + (d.fileSize || 0), 0),
      averageSize: documents.length > 0
        ? Math.round(documents.reduce((sum, d) => sum + (d.fileSize || 0), 0) / documents.length)
        : 0,
    };

    return stats;
  }

  async getDocumentsByPeriod(startDate: Date, endDate: Date, organizationId?: string) {
    const documents = organizationId
      ? await this.documentStorageService.getDocumentsByOrganization(organizationId)
      : await this.documentStorageService.getAllDocuments();

    return documents.filter(d => {
      const createdAt = new Date(d.createdAt);
      return createdAt >= startDate && createdAt <= endDate;
    });
  }

  async getTopDistributors(organizationId?: string) {
    const documents = organizationId
      ? await this.documentStorageService.getDocumentsByOrganization(organizationId)
      : await this.documentStorageService.getAllDocuments();

    const distributors = new Map<string, number>();

    documents.forEach(d => {
      if (d.distributorName) {
        distributors.set(d.distributorName, (distributors.get(d.distributorName) || 0) + 1);
      }
    });

    return Array.from(distributors.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  async getTotalInvoiceAmount(organizationId?: string) {
    const documents = organizationId
      ? await this.documentStorageService.getDocumentsByOrganization(organizationId)
      : await this.documentStorageService.getAllDocuments();

    const total = documents.reduce((sum, d) => sum + (d.totalAmount || 0), 0);
    return {
      totalAmount: total,
      currency: 'BRL',
      documentCount: documents.length,
    };
  }

  async getProcessingStatusSummary(organizationId?: string) {
    const documents = organizationId
      ? await this.documentStorageService.getDocumentsByOrganization(organizationId)
      : await this.documentStorageService.getAllDocuments();

    return {
      COMPLETED: documents.filter(d => d.status === 'COMPLETED').length,
      PENDING: documents.filter(d => d.status === 'PENDING').length,
      PROCESSING: documents.filter(d => d.status === 'PROCESSING').length,
      ERROR: documents.filter(d => d.status === 'ERROR').length,
    };
  }
}
