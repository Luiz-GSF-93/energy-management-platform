import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DocumentProcessingController } from './controllers/document-processing.controller';
import { ValidationService } from './services/validation.service';
import { ContractValidationService } from './services/contract-validation.service';
import { DistributorDetectorService } from './services/distributor-detector.service';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { InvoiceDataExtractorService } from './services/invoice-data-extractor.service';
import { DocumentStorageService } from './services/document-storage.service';
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
  controllers: [DocumentProcessingController],
  providers: [
    ValidationService,
    ContractValidationService,
    DistributorDetectorService,
    PdfExtractorService,
    InvoiceDataExtractorService,
    DocumentStorageService,
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
    DocumentProcessingQueueService,
  ],
})
export class DocumentProcessingModule {}
