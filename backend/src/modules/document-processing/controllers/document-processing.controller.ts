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
import { ConfidenceLevel } from '../enums/extraction-status.enum';

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
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const name = Array(32).fill(null).map(() => Math.round(Math.random() * 16).toString(16)).join('');
          cb(null, `${name}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req: any, file: any, cb: any) => {
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)) {
          return cb(new Error('Tipo inválido'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDocument(@UploadedFile() file: any, @Req() req: any) {
    try {
      if (!file) throw new BadRequestException('Arquivo não enviado');

      this.logger.log(`📤 Upload: ${file.originalname}`);

      const docId = `doc_${Date.now()}`;
      const extId = `ext_${Date.now()}`;

      let rawText = '';
      if (file.mimetype === 'application/pdf') {
        try {
          rawText = await this.pdfExtractor.extractTextFromPdf(file.path);
        } catch (error) {
          this.logger.warn(`PDF: ${error.message}`);
        }
      }

      const distributor = this.distributorDetector.detectDistributor(rawText);
      const data = this.genericParser.parse(rawText);
      data.distributor = distributor;

      const validation = await this.validationService.validateExtractedData(data);

      return {
        success: true,
        documentId: docId,
        extractionId: extId,
        extraction: {
          confidenceScore: validation.confidenceScore,
          confidenceLevel: validation.confidenceLevel,
          structuredData: data,
          validationNotes: validation.issues.join('\n'),
        },
        message: '✅ Processado!',
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':documentId/status')
  getStatus(@Param('documentId') documentId: string) {
    return { documentId, status: 'UPLOADED' };
  }

  @Get()
  listDocuments() {
    return { total: 0, documents: [] };
  }
}
