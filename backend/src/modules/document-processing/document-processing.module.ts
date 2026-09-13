import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DocumentProcessingController } from './controllers/document-processing.controller';
import { DocumentAnalyticsController } from './controllers/document-analytics.controller';
import { ValidationService } from './services/validation.service';
import { ContractValidationService } from './services/contract-validation.service';
import { DistributorDetectorService } from './services/distributor-detector.service';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { InvoiceDataExtractorService } from './services/invoice-data-extractor.service';
import { DocumentStorageService } from './services/document-storage.service';
import { DocumentAnalyticsService } from './services/document-analytics.service';
import { DocumentProcessingQueueService } from './services/document-processing.queue';
import { DocumentRepository } from './repositories/document.repository';
import { DocumentProcessingProcessor } from './processors/document-processing.processor';
import { GenericParser } from './parsers/generic.parser';
import { EnergyInvoiceParser } from './parsers/energy-invoice.parser';
import { CpflParser } from './parsers/cpfl.parser';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'document-processing',
      defaultJobOptions: {
        removeOnComplete: true,
      },
    }),
  ],
  controllers: [DocumentProcessingController, DocumentAnalyticsController],
  providers: [
    ValidationService,
    ContractValidationService,
    DistributorDetectorService,
    PdfExtractorService,
    InvoiceDataExtractorService,
    DocumentStorageService,
    DocumentAnalyticsService,
    DocumentProcessingQueueService,
    DocumentRepository,
    DocumentProcessingProcessor,
    GenericParser,
    EnergyInvoiceParser,
    CpflParser,
  ],
  exports: [
    ValidationService,
    ContractValidationService,
    EnergyInvoiceParser,
    InvoiceDataExtractorService,
    DocumentStorageService,
    DocumentAnalyticsService,
  ],
})
export class DocumentProcessingModule {}
