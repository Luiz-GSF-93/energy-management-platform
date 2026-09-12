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

// ✅ CORRIGIDO: Remover 'api/' - o global prefix já adiciona 'api/v1'
@Controller('document-processing')
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
      console.log(`🏢 Organização ID: ${orgId}`);

      const fileBuffer = await fs.readFile(file.path);
      let rawText = '';
      
      if (file.mimetype === 'application/pdf') {
        console.log(`📖 Extraindo texto do PDF...`);
        rawText = await this.pdfExtractor.extractText(fileBuffer);
        console.log(`✅ Texto extraído: ${rawText.length} caracteres`);
      }

      console.log(`🔎 Detectando distribuidor...`);
      const distributor = this.distributorDetectorService.detectDistributor(rawText);
      console.log(`✅ Distribuidor detectado: ${distributor}`);

      console.log(`📊 Parseando dados da fatura...`);
      const parsedData = this.genericParser.parse(rawText, distributor);
      console.log(`✅ Dados parseados:`, parsedData);

      console.log(`✔️ Validando extração...`);
      const extractionValidation = this.validationService.validateExtractedData(parsedData);
      console.log(`✅ Validação da extração:`, extractionValidation);

      console.log(`🔍 Validando contrato...`);
      const contractValidation = this.contractValidationService.validateAgainstContract(
        parsedData.clientCnpj || '',
        parsedData.consumerUnit || '',
        parsedData.referenceMonth,
        parsedData.consumptionKwh,
      );
      console.log(`✅ Validação do contrato:`, contractValidation);

      const isFinal = contractValidation.status === 'VALIDO';
      console.log(`📋 Status final: ${isFinal ? 'APPROVED' : 'PENDING_REVIEW'}`);

      const storagePath = this.defineStoragePath(
        orgId,
        'default-empresa',
        parsedData.referenceMonth,
        file.originalname,
      );
      
      console.log(`💾 Movendo arquivo para: ${storagePath}`);
      await this.moveFileToStructure(file.path, storagePath);
      console.log(`✅ Arquivo salvo com sucesso`);

      const documentId = uuidv4();
      console.log(`✅ Documento ID: ${documentId}`);

      const response = {
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
          notes: extractionValidation.notes || [],
        },
        audit: {
          extraction: extractionValidation,
          contract: contractValidation,
          status: isFinal ? 'APPROVED' : 'PENDING_REVIEW',
        },
        storagePath,
      };

      console.log(`📤 === RESPOSTA FINAL ===`);
      console.log(response);

      return response;
    } catch (error) {
      console.error('❌ === ERRO AO PROCESSAR FATURA ===');
      console.error('Erro completo:', error);
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'Erro ao processar fatura',
      );
    }
  }

  @Get()
  async listDocuments() {
    console.log('📋 Listando documentos...');
    return { success: true, data: [], message: 'Nenhum documento encontrado' };
  }

  @Get(':documentId/status')
  async getDocumentStatus(@Param('documentId') documentId: string) {
    console.log(`🔍 Buscando status do documento: ${documentId}`);
    return { success: true, data: { documentId, status: 'PENDING' } };
  }

  private defineStoragePath(
    organizationId: string,
    empresaId: string,
    referenceMonth: string,
    filename: string,
  ): string {
    const [year, month] = referenceMonth.split('-');
    const path = `organization/${organizationId}/empresa/${empresaId}/ano/${year}/mes/${month}/${filename}`;
    console.log(`📂 Storage path definido: ${path}`);
    return path;
  }

  private async moveFileToStructure(sourcePath: string, targetPath: string): Promise<void> {
    try {
      const targetDir = `./uploads/documents/${targetPath.substring(0, targetPath.lastIndexOf('/'))}`;
      console.log(`📁 Criando diretório: ${targetDir}`);
      await fs.mkdir(targetDir, { recursive: true });
      
      const fullTargetPath = `./uploads/documents/${targetPath}`;
      console.log(`📤 Movendo arquivo de ${sourcePath} para ${fullTargetPath}`);
      await fs.rename(sourcePath, fullTargetPath);
      console.log(`✅ Arquivo movido com sucesso`);
    } catch (error) {
      console.error(`❌ Erro ao mover arquivo:`, error);
      throw error;
    }
  }
}
