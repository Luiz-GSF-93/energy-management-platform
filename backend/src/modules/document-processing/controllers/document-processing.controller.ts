import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  InternalServerErrorException,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';
import * as fs from 'fs/promises';

import { ValidationService } from '../services/validation.service';
import { ContractValidationService } from '../services/contract-validation.service';
import { DistributorDetectorService } from '../services/distributor-detector.service';
import { PdfExtractorService } from '../services/pdf-extractor.service';
import { GenericParser } from '../parsers/generic.parser';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
}

@Controller('api/document-processing')
export class DocumentProcessingController {
  constructor(
    private validationService: ValidationService,
    private contractValidationService: ContractValidationService,
    private distributorDetectorService: DistributorDetectorService,
    private pdfExtractor: PdfExtractorService,
    private genericParser: GenericParser,
  ) {}

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
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: MulterFile,
    @Headers('x-organization-id') organizationId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    try {
      const orgId = organizationId || 'default-org';
      console.log(`📄 Processando: ${file.originalname}`);

      const fileBuffer = await fs.readFile(file.path);
      let rawText = '';
      if (file.mimetype === 'application/pdf') {
        rawText = await this.pdfExtractor.extractText(fileBuffer);
      }

      const distributor = this.distributorDetectorService.detectDistributor(rawText);
      const parsedData = this.genericParser.parse(rawText, distributor);
      const extractionValidation = this.validationService.validateExtractedData(parsedData);

      const contractValidation = this.contractValidationService.validateAgainstContract(
        parsedData.clientCnpj || '',
        parsedData.consumerUnit || '',
        parsedData.referenceMonth,
        parsedData.consumptionKwh,
      );

      const isFinal = contractValidation.status === 'VALIDO';

      const storagePath = this.defineStoragePath(
        orgId,
        'default-empresa',
        parsedData.referenceMonth,
        file.originalname,
      );
      await this.moveFileToStructure(file.path, storagePath);

      const documentId = uuidv4();

      return {
        success: true,
        documentId,
        extraction: {
          invoiceNumber: parsedData.invoiceNumber,
          referenceMonth: parsedData.referenceMonth,
          distributor,
          consumptionKwh: parsedData.consumptionKwh,
          totalAmount: parsedData.totalAmount,
          confidenceLevel: extractionValidation.confidenceLevel,
          confidenceScore: extractionValidation.confidenceScore,
          
          clientCnpj: parsedData.clientCnpj,
          clientName: parsedData.clientName,
          consumerUnitNumber: parsedData.consumerUnitNumber,
        },
        audit: {
          extraction: extractionValidation,
          contract: contractValidation,
          status: isFinal ? 'APPROVED' : 'PENDING_REVIEW',
        },
        storagePath,
      };
    } catch (error) {
      console.error('❌ Erro:', error);
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'Erro ao processar fatura',
      );
    }
  }

  @Get()
  async listDocuments() {
    return { success: true, data: [], message: 'Nenhum documento encontrado' };
  }

  @Get(':documentId/status')
  async getDocumentStatus(@Param('documentId') documentId: string) {
    return { success: true, data: { documentId, status: 'PENDING' } };
  }

  private defineStoragePath(
    organizationId: string,
    empresaId: string,
    referenceMonth: string,
    filename: string,
  ): string {
    const [year, month] = referenceMonth.split('-');
    return `organization/${organizationId}/empresa/${empresaId}/ano/${year}/mes/${month}/${filename}`;
  }

  private async moveFileToStructure(sourcePath: string, targetPath: string): Promise<void> {
    const targetDir = `./uploads/documents/${targetPath.substring(0, targetPath.lastIndexOf('/'))}`;
    await fs.mkdir(targetDir, { recursive: true });
    await fs.rename(sourcePath, `./uploads/documents/${targetPath}`);
  }
}
