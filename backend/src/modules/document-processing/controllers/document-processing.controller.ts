import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import { DocumentUpload } from '../entities/document-upload.entity';
import { InvoiceExtraction } from '../entities/invoice-extraction.entity';
import { ValidationService } from '../services/validation.service';
import { DistributorDetectorService } from '../services/distributor-detector.service';
import { PdfExtractorService } from '../services/pdf-extractor.service';
import { GenericParser } from '../parsers/generic.parser';
import { DocumentStatus } from '../enums/document-status.enum';
import { ExtractionStatus, ConfidenceLevel } from '../enums/extraction-status.enum';

@Controller('api/document-processing')
export class DocumentProcessingController {
  private readonly logger = new Logger(DocumentProcessingController.name);

  constructor(
    @InjectRepository(DocumentUpload)
    private documentRepo: Repository<DocumentUpload>,
    @InjectRepository(InvoiceExtraction)
    private extractionRepo: Repository<InvoiceExtraction>,
    private validationService: ValidationService,
    private distributorDetector: DistributorDetectorService,
    private pdfExtractor: PdfExtractorService,
    private genericParser: GenericParser,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = join(process.cwd(), 'uploads', 'documents');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req: any, file: any, cb: any) => {
        const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!allowedMimes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Tipo de arquivo não suportado: ${file.mimetype}`,
            ),
            false,
          );
        }
        if (file.size > 10 * 1024 * 1024) {
          return cb(
            new BadRequestException('Arquivo maior que 10MB'),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    try {
      if (!file) {
        throw new BadRequestException('Arquivo não enviado');
      }

      const organizationId = req.user?.organizationId || 'default-org';
      const userId = req.user?.id || 'default-user';

      this.logger.log(`📤 Upload iniciado: ${file.originalname}`);

      // 1. Criar documento
      const document = this.documentRepo.create({
        id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        organizationId,
        uploadedByUserId: userId as any,
        filename: file.originalname,
        storagePath: file.path,
        mimeType: file.mimetype,
        fileSize: file.size,
        status: DocumentStatus.UPLOADED,
      });

      const savedDoc = await this.documentRepo.save(document);
      this.logger.log(`✅ Documento: ${savedDoc.id}`);

      // 2. Extrair texto
      let rawText = '';
      if (file.mimetype === 'application/pdf') {
        try {
          rawText = await this.pdfExtractor.extractTextFromPdf(file.path);
        } catch (error) {
          this.logger.warn(`⚠️ Erro ao extrair PDF: ${error.message}`);
        }
      }

      // 3. Detectar distribuidora
      const distributor = this.distributorDetector.detectDistributor(rawText);

      // 4. Parse
      const structuredData = this.genericParser.parse(rawText);
      structuredData.distributor = distributor;

      // 5. Validar
      const validation = await this.validationService.validateExtractedData(
        structuredData,
      );

      // 6. Criar extração
      const extraction = this.extractionRepo.create({
        id: `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        documentId: savedDoc.id,
        organizationId,
        processor: 'PDF_TEXT_EXTRACTOR',
        processorVersion: '1.0.0',
        extractionStatus:
          validation.confidenceLevel === ConfidenceLevel.HIGH
            ? ExtractionStatus.EXTRACTED
            : ExtractionStatus.NEEDS_REVISION,
        confidenceLevel: validation.confidenceLevel,
        confidenceScore: validation.confidenceScore,
        rawText,
        structuredData,
        detectedDistributor: distributor,
        validationNotes: validation.issues.join('\n'),
        processingFinishedAt: new Date(),
      });

      const savedExtraction = await this.extractionRepo.save(extraction);
      this.logger.log(`✅ Extração: ${savedExtraction.id}`);

      return {
        success: true,
        documentId: savedDoc.id,
        extractionId: savedExtraction.id,
        status: 'UPLOADED',
        extraction: {
          id: savedExtraction.id,
          extractionStatus: savedExtraction.extractionStatus,
          confidenceScore: savedExtraction.confidenceScore,
          confidenceLevel: savedExtraction.confidenceLevel,
          structuredData: savedExtraction.structuredData,
          validationNotes: savedExtraction.validationNotes,
        },
        message: '📄 Fatura processada!',
      };
    } catch (error) {
      this.logger.error(`❌ Erro: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':documentId/status')
  async getDocumentStatus(@Param('documentId') documentId: string) {
    try {
      const document = await this.documentRepo.findOne({
        where: { id: documentId },
      });

      if (!document) {
        throw new BadRequestException('Documento não encontrado');
      }

      const extraction = await this.extractionRepo.findOne({
        where: { documentId },
      });

      return {
        documentId,
        filename: document.filename,
        uploadedAt: document.uploadedAt,
        status: document.status,
        extraction,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Get()
  async listDocuments(@Req() req: any) {
    try {
      const organizationId = req.user?.organizationId || 'default-org';

      const documents = await this.documentRepo.find({
        where: { organizationId },
        order: { uploadedAt: 'DESC' },
      });

      return { total: documents.length, documents };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
