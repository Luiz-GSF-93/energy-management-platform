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
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { PdfExtractorService } from '../services/pdf-extractor.service';
import { ValidationService } from '../services/validation.service';
import { ContractValidationService } from '../services/contract-validation.service';
import { DistributorDetectorService } from '../services/distributor-detector.service';
import { GenericParser } from '../parsers/generic.parser';
import { ConfidenceLevel } from '../enums/confidence-level.enum';

@Controller('document-processing')
export class DocumentProcessingController {
  constructor(
    private pdfExtractorService: PdfExtractorService,
    private validationService: ValidationService,
    private contractValidationService: ContractValidationService,
    private distributorDetectorService: DistributorDetectorService,
    private genericParser: GenericParser,
  ) {}

  private readonly ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
  ];

  private readonly ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/documents',
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
          const ext = extname(file.originalname);
          cb(null, `${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: multer.File,
    @Headers('x-organization-id') organizationId: string,
    @Headers('x-empresa-id') empresaId: string = 'default-empresa',
  ) {
    try {
      console.log(`📤 === UPLOAD DE FATURA DE ENERGIA ===`);
      console.log(`📄 Arquivo: ${file.originalname}`);
      console.log(`📦 Tamanho: ${file.size} bytes`);
      console.log(`📋 MIME Type: ${file.mimetype}`);
      console.log(`📁 Caminho: ${file.path}`);
      console.log(`🏢 Org: ${organizationId}, Empresa: ${empresaId}`);

      // ============================================
      // 1️⃣ VALIDAÇÕES DE ARQUIVO
      // ============================================

      const fileExtension = extname(file.originalname).toLowerCase();
      if (!this.ALLOWED_EXTENSIONS.includes(fileExtension)) {
        console.error(`❌ Extensão não permitida: ${fileExtension}`);
        await this.deleteFile(file.path);
        throw new BadRequestException(
          `Extensão não permitida. Aceitos: ${this.ALLOWED_EXTENSIONS.join(', ')}`,
        );
      }

      if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        console.error(`❌ MIME type não permitido: ${file.mimetype}`);
        await this.deleteFile(file.path);
        throw new BadRequestException(
          `Tipo de arquivo não permitido. Aceitos: PDF, PNG, JPEG. Recebido: ${file.mimetype}`,
        );
      }

      if (file.size > this.MAX_FILE_SIZE) {
        console.error(`❌ Arquivo muito grande: ${file.size} bytes`);
        await this.deleteFile(file.path);
        throw new BadRequestException(
          `Arquivo muito grande. Máximo: 10 MB. Recebido: ${(file.size / 1024 / 1024).toFixed(2)} MB`,
        );
      }

      // Ler arquivo do disco
      const fileBuffer = fs.readFileSync(file.path);
      console.log(`✓ Arquivo lido do disco: ${fileBuffer.length} bytes`);

      const isValidInvoiceFile = await this.validateInvoiceFile(
        fileBuffer,
        file.mimetype,
      );
      if (!isValidInvoiceFile) {
        console.error(`❌ Arquivo não parece ser uma fatura de energia`);
        await this.deleteFile(file.path);
        throw new BadRequestException(
          `Arquivo não parece ser uma fatura de energia. Por favor, envie um PDF ou imagem válido(a) de fatura.`,
        );
      }

      console.log(`✅ Validações de arquivo passaram`);

      // ============================================
      // 2️⃣ EXTRAÇÃO DE TEXTO
      // ============================================

      console.log(`📖 Extraindo texto...`);
      const extractedText = await this.pdfExtractorService.extractText(
        fileBuffer,
      );
      console.log(`✅ Texto extraído: ${extractedText.length} caracteres`);

      // ============================================
      // 3️⃣ DETECÇÃO DE DISTRIBUIDORA
      // ============================================

      console.log(`🔎 Detectando distribuidor...`);
      const distributor = this.distributorDetectorService.detectDistributor(
        extractedText,
      );
      console.log(`✅ Distribuidor detectado: ${distributor}`);

      // ============================================
      // 4️⃣ PARSING DE DADOS
      // ============================================

      console.log(`📊 Parseando dados da fatura...`);
      const parsedData = this.genericParser.parse(extractedText, distributor);
      console.log(`✅ Dados parseados:`, parsedData);

      // ============================================
      // 5️⃣ VALIDAÇÃO DE EXTRAÇÃO
      // ============================================

      console.log(`✔️ Validando extração...`);
      const validationResult =
        this.validationService.validateExtractedData(parsedData);
      console.log(`✅ Validação da extração:`, validationResult);

      // ============================================
      // 6️⃣ VALIDAÇÃO DE CONTRATO
      // ============================================

      console.log(`🔍 Validando contrato...`);
      const contractValidation =
        this.contractValidationService.validateAgainstContract(
          parsedData.clientCnpj || '',
          parsedData.consumerUnit || '',
          parsedData.referenceMonth,
          parsedData.consumptionKwh,
        );
      console.log(`✅ Validação do contrato:`, contractValidation);

      // ============================================
      // 7️⃣ DETERMINAR STATUS FINAL
      // ============================================

      const finalStatus =
        validationResult.confidenceLevel === ConfidenceLevel.HIGH &&
        contractValidation.status === 'VALIDO'
          ? 'APPROVED'
          : 'PENDING_REVIEW';

      console.log(`📋 Status final: ${finalStatus}`);

      // ============================================
      // 8️⃣ ARMAZENAR ARQUIVO
      // ============================================

      const storagePath = this.defineStoragePath(
        organizationId,
        empresaId,
        parsedData.referenceMonth,
        file.originalname,
      );

      console.log(`📂 Storage path definido: ${storagePath}`);

      await this.moveFileToStructure(file.path, storagePath);
      console.log(`✅ Arquivo movido com sucesso`);

      // ============================================
      // 9️⃣ GERAR RESPONSE
      // ============================================

      const documentId = uuidv4();

      const response = {
        success: true,
        documentId,
        extraction: {
          invoiceNumber: parsedData.invoiceNumber,
          referenceMonth: parsedData.referenceMonth,
          distributor,
          consumptionKwh: parsedData.consumptionKwh,
          totalAmount: parsedData.totalAmount,
          confidenceLevel: validationResult.confidenceLevel,
          confidenceScore: validationResult.confidenceScore,
          clientCnpj: parsedData.clientCnpj,
          clientName: parsedData.clientName,
          consumerUnitNumber: parsedData.consumerUnit,
          notes: validationResult.notes,
        },
        audit: {
          extraction: validationResult,
          contract: contractValidation,
          status: finalStatus,
        },
        storagePath,
      };

      console.log(`✅ Arquivo salvo com sucesso`);
      console.log(`✅ Documento ID: ${documentId}`);
      console.log(`📤 === RESPOSTA FINAL ===`);
      console.log(response);

      return response;
    } catch (error) {
      console.error(`❌ === ERRO NO UPLOAD ===`);
      if (error instanceof BadRequestException) {
        console.error(`Erro de validação: ${error.message}`);
        throw error;
      }
      console.error(`Erro:`, error);
      throw new InternalServerErrorException(
        'Erro ao processar fatura. Por favor, tente novamente.',
      );
    }
  }

  @Get('/')
  listDocuments() {
    return { documents: [] };
  }

  @Get('/:documentId/status')
  getDocumentStatus(@Param('documentId') documentId: string) {
    return {
      documentId,
      status: 'PENDING',
    };
  }

  private async validateInvoiceFile(
    buffer: Buffer,
    mimeType: string,
  ): Promise<boolean> {
    try {
      console.log(`🔍 Validando se é arquivo de fatura...`);

      if (!buffer || buffer.length === 0) {
        console.error(`❌ Buffer vazio`);
        return false;
      }

      if (mimeType === 'application/pdf') {
        const header = buffer.toString('ascii', 0, 4);
        const isPDF = header === '%PDF';
        console.log(`  ✓ Validação PDF: ${isPDF ? 'VÁLIDO' : 'INVÁLIDO'}`);
        console.log(`  ✓ Header: "${header}"`);
        return isPDF;
      }

      if (['image/png', 'image/jpeg', 'image/jpg'].includes(mimeType)) {
        const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50;
        const isJPEG = buffer[0] === 0xff && buffer[1] === 0xd8;
        const isValid = isPNG || isJPEG;
        console.log(`  ✓ Validação Imagem: ${isValid ? 'VÁLIDO' : 'INVÁLIDO'}`);
        console.log(`  ✓ Primeiros bytes: [${buffer[0]}, ${buffer[1]}]`);
        return isValid;
      }

      return false;
    } catch (error) {
      console.error(`⚠️ Erro na validação de arquivo:`, error);
      return false;
    }
  }

  private defineStoragePath(
    organizationId: string,
    empresaId: string,
    referenceMonth: string,
    originalFilename: string,
  ): string {
    const [year, month] = referenceMonth.split('-');
    const filename = originalFilename.replace(/\s+/g, '_');
    return `organization/${organizationId}/empresa/${empresaId}/ano/${year}/mes/${month}/${filename}`;
  }

  private async moveFileToStructure(
    sourcePath: string,
    destinationPath: string,
  ): Promise<void> {
    const fullDestPath = `./uploads/documents/${destinationPath}`;
    const destDir = path.dirname(fullDestPath);

    console.log(`📁 Criando diretório: ${destDir}`);
    await fs.promises.mkdir(destDir, { recursive: true });

    console.log(`📤 Movendo arquivo de ${sourcePath} para ${fullDestPath}`);
    await fs.promises.rename(sourcePath, fullDestPath);
  }

  private async deleteFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        console.log(`🗑️ Arquivo deletado: ${filePath}`);
      }
    } catch (error) {
      console.warn(`⚠️ Erro ao deletar arquivo: ${filePath}`, error);
    }
  }
}
