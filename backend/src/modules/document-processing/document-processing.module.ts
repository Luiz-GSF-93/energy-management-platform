import { Module } from '@nestjs/common';
import { DocumentProcessingController } from './controllers/document-processing.controller';
import { ValidationService } from './services/validation.service';
import { DistributorDetectorService } from './services/distributor-detector.service';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { GenericParser } from './parsers/generic.parser';
import { EnergyInvoiceParser } from './parsers/energy-invoice.parser';
import { CpflParser } from './parsers/cpfl.parser';

@Module({
  controllers: [DocumentProcessingController],
  providers: [
    ValidationService,
    DistributorDetectorService,
    PdfExtractorService,
    GenericParser,
    EnergyInvoiceParser,
    CpflParser,
  ],
  exports: [ValidationService, EnergyInvoiceParser, CpflParser],
})
export class DocumentProcessingModule {}
