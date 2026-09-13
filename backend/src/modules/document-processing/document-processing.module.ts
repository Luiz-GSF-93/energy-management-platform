import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bull';
import { DocumentProcessingController } from './controllers/document-processing.controller';
import { DocumentAnalyticsController } from './controllers/document-analytics.controller';
import { DocumentAuthController } from './controllers/document-auth.controller';
import { ValidationService } from './services/validation.service';
import { ContractValidationService } from './services/contract-validation.service';
import { DistributorDetectorService } from './services/distributor-detector.service';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { InvoiceDataExtractorService } from './services/invoice-data-extractor.service';
import { DocumentStorageService } from './services/document-storage.service';
import { DocumentAnalyticsService } from './services/document-analytics.service';
import { DocumentAuthService } from './services/document-auth.service';
import { DocumentProcessingQueueService } from './services/document-processing.queue';
import { DocumentRepository } from './repositories/document.repository';
import { DocumentProcessingProcessor } from './processors/document-processing.processor';
import { DocumentAuthGuard } from './guards/document-auth.guard';
import { GenericParser } from './parsers/generic.parser';
import { EnergyInvoiceParser } from './parsers/energy-invoice.parser';
import { CpflParser } from './parsers/cpfl.parser';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'document-processing-secret-key',
      signOptions: { expiresIn: '1h' },
    }),
    BullModule.registerQueue({
      name: 'document-processing',
      defaultJobOptions: {
        removeOnComplete: true,
      },
    }),
  ],
  controllers: [
    DocumentProcessingController,
    DocumentAnalyticsController,
    DocumentAuthController,
  ],
  providers: [
    ValidationService,
    ContractValidationService,
    DistributorDetectorService,
    PdfExtractorService,
    InvoiceDataExtractorService,
    DocumentStorageService,
    DocumentAnalyticsService,
    DocumentAuthService,
    DocumentProcessingQueueService,
    DocumentRepository,
    DocumentProcessingProcessor,
    DocumentAuthGuard,
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
    DocumentAuthService,
  ],
})
export class DocumentProcessingModule {}
