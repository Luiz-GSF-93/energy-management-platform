import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Inject,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';
import * as fs from 'fs/promises';
import * as pdfParse from 'pdf-parse';

import { ValidationService } from '../services/validation.service';
import { DistributorDetectorService } from '../services/distributor-detector.service';
import { PdfExtractorService } from '../services/pdf-extractor.service';
import { GenericParser } from '../parsers/generic.parser';

@Controller('api/document-processing')
export class DocumentProcessingController {
  constructor(
    private validationService: ValidationService,
    private distributorDetectorService: DistributorDetectorService,
    private pdfExtractor: PdfExtractorService,
    private genericParser: GenericParser,
  ) {}

  /**
   * POST /api/document-processing/upload
   * Upload de fatura com processamento automático
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/documents',
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!validTypes.includes(file.mimetype)) {
          return cb(new BadRequestException('Formato inválido'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    try {
      // 1. Ler arquivo
      const fileBuffer = await fs.readFile(file.path);

      // 2. Extrair texto (PDF ou OCR para imagens)
      let rawText = '';
      if (file.mimetype === 'application/pdf') {
        const pdfData = await pdfParse(fileBuffer);
        rawText = pdfData.text;
      } else {
        // TODO: Implementar OCR para imagens (Tesseract)
        rawText = '[OCR não implementado] - Salve como PDF para extração';
      }

      // 3. Detectar concessionária
      const distributor = this.distributorDetectorService.detectDistributor(rawText);

      // 4. Parser de fatura
      const parsedData = this.genericParser.parse(rawText, distributor);

      // 5. Validar dados extraídos
      const validation = this.validationService.validateExtractedData(parsedData);

      // 6. Definir caminho de armazenamento estruturado
      // organization/{org_id}/empresa/{empresa_id}/ano/{year}/mes/{month}/{filename}
      const storagePath = this.defineStoragePath(
        parsedData.organizationId,
        parsedData.empresaId,
        parsedData.referenceMonth,
        file.originalname,
      );

      // 7. Mover arquivo para estrutura final
      await this.moveFileToStructure(file.path, storagePath);

      return {
        success: true,
        documentId: uuidv4(),
        extraction: {
          invoiceNumber: parsedData.invoiceNumber,
          referenceMonth: parsedData.referenceMonth,
          distributor: distributor,
          consumptionKwh: parsedData.consumptionKwh,
          totalAmount: parsedData.totalAmount,
          confidenceLevel: validation.confidenceLevel,
          confidenceScore: validation.confidenceScore,
          validationNotes: validation.notes,
        },
        storagePath,
      };
    } catch (error) {
      console.error('Erro ao processar documento:', error);
      throw new InternalServerErrorException('Erro ao processar fatura');
    }
  }

  /**
   * GET /api/document-processing
   * Lista documentos processados da organização
   */
  @Get()
  async listDocuments() {
    // TODO: Implementar consulta ao banco
    // SELECT * FROM document_uploads WHERE organization_id = :orgId
    return {
      success: true,
      data: [],
      message: 'Nenhum documento encontrado',
    };
  }

  /**
   * GET /api/document-processing/:documentId/status
   * Consultar status de um documento
   */
  @Get(':documentId/status')
  async getDocumentStatus(@Param('documentId') documentId: string) {
    // TODO: Implementar consulta ao banco
    // SELECT * FROM document_uploads WHERE id = :documentId
    return {
      success: true,
      data: { documentId, status: 'PENDING' },
    };
  }

  /**
   * Helpers
   */
  private defineStoragePath(
    organizationId: string,
    empresaId: string,
    referenceMonth: string, // YYYY-MM
    filename: string,
  ): string {
    const [year, month] = referenceMonth.split('-');
    return `organization/${organizationId}/empresa/${empresaId}/ano/${year}/mes/${month}/${filename}`;
  }

  private async moveFileToStructure(sourcePath: string, targetPath: string): Promise<void> {
    const targetDir = targetPath.substring(0, targetPath.lastIndexOf('/'));
    await fs.mkdir(targetDir, { recursive: true });
    await fs.rename(sourcePath, `./uploads/documents/${targetPath}`);
  }
}
