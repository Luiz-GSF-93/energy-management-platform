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
import * as fs from 'fs';
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
          return cb(new Error(`Tipo não suportado`), false);
        }
        if (file.size > 10 * 1024 * 1024) {
          return cb(new Error('Arquivo muito grande'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDocument(@UploadedFile() file: any, @Req() req: any) {
    try {
      if (!file) {
        throw new BadRequestException('Arquivo não enviado');
      }

      this.logger.log(`📤 Upload: ${file.originalname}`);

      // Dados mockados para teste
      const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const extractionId = `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      let rawText = '';
      if (file.mimetype === 'application/pdf') {
        try {
          rawText = await this.pdfExtractor.extractTextFromPdf(file.path);
        } catch (error) {
          this.logger.warn(`Erro PDF: ${error.message}`);
          rawText = 'Erro ao extrair';
        }
      }

      const distributor = this.distributorDetector.detectDistributor(rawText);
      const structuredData = this.genericParser.parse(rawText);
      structuredData.distributor = distributor;

      const validation = await this.validationService.validateExtractedData(structuredData);

      this.logger.log(`✅ Processado com score ${validation.confidenceScore}%`);

      return {
        success: true,
        documentId,
        extractionId,
        status: 'UPLOADED',
        extraction: {
          id: extractionId,
          extractionStatus:
            validation.confidenceLevel === ConfidenceLevel.HIGH
              ? ExtractionStatus.EXTRACTED
              : ExtractionStatus.NEEDS_REVISION,
          confidenceScore: validation.confidenceScore,
          confidenceLevel: validation.confidenceLevel,
          structuredData,
          validationNotes: validation.issues.join('\n'),
        },
        message: '📄 Processado com sucesso!',
      };
    } catch (error) {
      this.logger.error(`Erro: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':documentId/status')
  async getDocumentStatus(@Param('documentId') documentId: string) {
    return {
      documentId,
      status: 'UPLOADED',
      message: 'Documento processado',
    };
  }

  @Get()
  async listDocuments(@Req() req: any) {
    return {
      total: 0,
      documents: [],
      message: 'Nenhum documento',
    };
  }
}
