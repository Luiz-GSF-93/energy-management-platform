import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentProcessingController } from './controllers/document-processing.controller';
import { ValidationService } from './services/validation.service';
import { DistributorDetectorService } from './services/distributor-detector.service';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { GenericParser } from './parsers/generic.parser';
import { DocumentUpload } from './entities/document-upload.entity';
import { InvoiceExtraction } from './entities/invoice-extraction.entity';
import { ExtractionLog } from './entities/extraction-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentUpload,
      InvoiceExtraction,
      ExtractionLog,
    ]),
  ],
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
