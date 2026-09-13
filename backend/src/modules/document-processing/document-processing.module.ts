import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentProcessingController } from './controllers/document-processing.controller';
import { ValidationService } from './services/validation.service';
import { ContractValidationService } from './services/contract-validation.service';
import { DistributorDetectorService } from './services/distributor-detector.service';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { InvoiceDataExtractorService } from './services/invoice-data-extractor.service';
import { DocumentPersistenceService } from './services/document-persistence.service';
import { DocumentRepository } from './repositories/document.repository';
import { DocumentEntity } from './entities/document.entity';
import { GenericParser } from './parsers/generic.parser';
import { EnergyInvoiceParser } from './parsers/energy-invoice.parser';
import { CpflParser } from './parsers/cpfl.parser';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity])],
  controllers: [DocumentProcessingController],
  providers: [
    ValidationService,
    ContractValidationService,
    DistributorDetectorService,
    PdfExtractorService,
    InvoiceDataExtractorService,
    DocumentPersistenceService,
    DocumentRepository,
    GenericParser,
    EnergyInvoiceParser,
    CpflParser,
  ],
  exports: [
    ValidationService,
    ContractValidationService,
    EnergyInvoiceParser,
    InvoiceDataExtractorService,
    DocumentPersistenceService,
  ],
})
export class DocumentProcessingModule {}
