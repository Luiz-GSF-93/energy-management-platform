import { Injectable } from '@nestjs/common';
import { DocumentEntity } from '../entities/document.entity';
import { ExtractedInvoiceData } from './invoice-data-extractor.service';

export interface DocumentSaveRequest {
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  extractedText: string;
  invoiceData: ExtractedInvoiceData;
  validationResult: { isValid: boolean; score: number; errors: string[] };
  organizationId: string;
  empresaId: string;
}

@Injectable()
export class DocumentPersistenceService {
  // Será implementado após conectar ao banco de dados
  
  async saveDocument(request: DocumentSaveRequest): Promise<Partial<DocumentEntity>> {
    console.log('💾 === PREPARANDO PARA SALVAR DOCUMENTO ===\n');

    const document: Partial<DocumentEntity> = {
      filename: request.filename,
      originalName: request.originalName,
      mimeType: request.mimeType,
      fileSize: request.fileSize,
      filePath: request.filePath,
      extractedText: request.extractedText,
      invoiceNumber: request.invoiceData.invoiceNumber,
      emissionDate: request.invoiceData.emissionDate,
      referenceMonth: request.invoiceData.referenceMonth,
      dueDate: request.invoiceData.dueDate,
      clientName: request.invoiceData.clientName,
      clientCnpj: request.invoiceData.clientCnpj,
      distributorName: request.invoiceData.distributorName,
      consumerUnit: request.invoiceData.consumerUnit,
      consumptionKwh: request.invoiceData.consumptionKwh,
      demandKw: request.invoiceData.demandKw,
      totalAmount: request.invoiceData.totalAmount,
      currency: request.invoiceData.currency || 'BRL',
      isValidInvoice: request.validationResult.isValid,
      validationScore: request.validationResult.score,
      validationErrors: request.validationResult.errors.join('; '),
      status: request.validationResult.isValid ? 'COMPLETED' : 'ERROR',
      organizationId: request.organizationId,
      empresaId: request.empresaId,
      processedAt: new Date(),
    };

    console.log(`✅ Documento preparado para salvar`);
    console.log(`✅ NF: ${document.invoiceNumber}`);
    console.log(`✅ Cliente: ${document.clientName}`);
    console.log(`✅ Total: R$ ${document.totalAmount}\n`);

    return document;
  }
}
