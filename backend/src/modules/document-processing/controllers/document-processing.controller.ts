import { Controller, Post, Get, Param, UploadedFile, UseInterceptors, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { PdfExtractorService } from '../services/pdf-extractor.service';
import { InvoiceDataExtractorService } from '../services/invoice-data-extractor.service';
import { DocumentPersistenceService } from '../services/document-persistence.service';

type UploadedFileType = Express.Multer.File;

@Controller('document-processing')
export class DocumentProcessingController {
  constructor(
    private pdfExtractorService: PdfExtractorService,
    private invoiceDataExtractorService: InvoiceDataExtractorService,
    private documentPersistenceService: DocumentPersistenceService,
  ) {}
  
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/documents',
        filename: (req, file, cb) => {
          const ext = path.extname(file.originalname);
          const filename = `${Date.now()}-${uuidv4()}${ext}`;
          cb(null, filename);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: UploadedFileType,
    @Headers('x-organization-id') organizationId: string,
    @Headers('x-empresa-id') empresaId: string,
  ) {
    console.log('📤 === UPLOAD INICIADO ===');
    console.log(`📦 Arquivo: ${file.originalname}`);
    console.log(`📊 Tamanho: ${file.size} bytes`);
    console.log(`🏢 Org: ${organizationId}, Empresa: ${empresaId}\n`);

    try {
      const fileBuffer = fs.readFileSync(file.path);
      console.log(`✅ Arquivo lido: ${fileBuffer.length} bytes`);

      let extractedText = '';
      let invoiceData: any = null;
      let validation: any = null;
      let persistedData: any = null;

      if (file.mimetype === 'application/pdf') {
        console.log('\n🔄 Iniciando extração de texto...\n');
        extractedText = await this.pdfExtractorService.extractText(fileBuffer);
        console.log(`✅ Texto extraído: ${extractedText.length} caracteres\n`);

        console.log('🔄 Iniciando extração de dados estruturados...\n');
        invoiceData = this.invoiceDataExtractorService.extractData(extractedText);

        console.log('\n🔄 Validando fatura...\n');
        validation = this.invoiceDataExtractorService.validateInvoice(invoiceData);

        // ✅ Persistir dados
        console.log('\n🔄 Persistindo dados...\n');
        persistedData = await this.documentPersistenceService.saveDocument({
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          filePath: file.path,
          extractedText,
          invoiceData,
          validationResult: validation,
          organizationId,
          empresaId,
        });
      }

      return {
        success: true,
        message: 'Upload realizado com sucesso',
        file: {
          originalName: file.originalname,
          filename: file.filename,
          size: file.size,
          mimetype: file.mimetype,
          path: file.path,
        },
        headers: {
          organizationId,
          empresaId,
        },
        extraction: {
          textLength: extractedText.length,
          textPreview: extractedText.substring(0, 300),
        },
        invoiceData: invoiceData ? {
          invoiceNumber: invoiceData.invoiceNumber,
          emissionDate: invoiceData.emissionDate,
          referenceMonth: invoiceData.referenceMonth,
          dueDate: invoiceData.dueDate,
          clientName: invoiceData.clientName,
          clientCnpj: invoiceData.clientCnpj,
          distributorName: invoiceData.distributorName,
          consumerUnit: invoiceData.consumerUnit,
          consumptionKwh: invoiceData.consumptionKwh,
          demandKw: invoiceData.demandKw,
          totalAmount: invoiceData.totalAmount,
          currency: invoiceData.currency,
        } : null,
        validation: validation || null,
        persisted: persistedData || null,
      };
    } catch (error) {
      console.error('❌ Erro no upload:', error);
      return {
        success: false,
        message: 'Erro ao processar o upload',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Get()
  listDocuments() {
    console.log('📋 Listando documentos...');
    return { 
      success: true,
      documents: [],
      message: 'Lista de documentos vazia',
    };
  }

  @Get(':documentId/status')
  getDocumentStatus(@Param('documentId') documentId: string) {
    console.log(`📍 Buscando status do documento: ${documentId}`);
    return { 
      success: true,
      documentId, 
      status: 'PENDING',
    };
  }
}
