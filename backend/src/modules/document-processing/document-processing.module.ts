import { Module } from '@nestjs/common';
import { DocumentProcessingController } from './controllers/document-processing.controller';
import { ValidationService } from './services/validation.service';
import { DistributorDetectorService } from './services/distributor-detector.service';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { GenericParser } from './parsers/generic.parser';

@Module({
  controllers: [DocumentProcessingController],
  providers: [
    ValidationService,
    DistributorDetectorService,
    PdfExtractorService,
    GenericParser,
  ],
  exports: [
    ValidationService,
    GenericParser,
  ],
})
export class DocumentProcessingModule {}
