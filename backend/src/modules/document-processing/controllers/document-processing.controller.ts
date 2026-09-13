import { Controller, Post, Get, Param, UploadedFile, UseInterceptors, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { PdfExtractorService } from '../services/pdf-extractor.service';
import { InvoiceDataExtractorService } from '../services/invoice-data-extractor.service';
import { DocumentStorageService } from '../services/document-storage.service';

type UploadedFileType = Express.Multer.File;

@Controller('document-processing')
export class DocumentProcessingController {
  constructor(
    private pdfExtractorService: PdfExtractorService,
    private invoiceDataExtractorService: InvoiceDataExtractorService,
    private documentStorageService: DocumentStorageService,
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
    }),
  )
  async uploadDocument(
    @UploadedFile() file: UploadedFileType,
    @Headers('x-organization-id') organizationId: string,
    @Headers('x-empresa-id') empresaId: string,
  ) {
    console.log('📤 === UPLOAD INICIADO ===');
    console.log(`📄 Arquivo: ${file.originalname} (${file.size} bytes)`);
    console.log(`🏢 Organização: ${organizationId}`);
    console.log(`🏭 Empresa: ${empresaId}`);

    try {
      // Ler o arquivo do disco
      const fileBuffer = fs.readFileSync(file.path);
      console.log(`📦 Buffer lido: ${fileBuffer.length} bytes`);

      let extractedText = '';
      let invoiceData: any = {};

      // Se for PDF, extrair texto
      if (file.mimetype === 'application/pdf') {
        console.log('🔍 Extraindo texto do PDF...');
        extractedText = await this.pdfExtractorService.extractText(fileBuffer);
        console.log(`✅ Texto extraído: ${extractedText.length} caracteres`);

        // Extrair dados estruturados
        console.log('📊 Extraindo dados de fatura...');
        invoiceData = this.invoiceDataExtractorService.extractData(extractedText);
        console.log(`✅ Dados extraídos: ${JSON.stringify(invoiceData)}`);
      }

      // 💾 Salvar documento no storage
      console.log('💾 Salvando documento...');
      const savedDocument = await this.documentStorageService.saveDocument({
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        filePath: file.path,
        extractedText,
        invoiceNumber: invoiceData.invoiceNumber,
        emissionDate: invoiceData.emissionDate,
        referenceMonth: invoiceData.referenceMonth,
        dueDate: invoiceData.dueDate,
        clientCnpj: invoiceData.clientCnpj,
        distributorName: invoiceData.distributorName,
        currency: invoiceData.currency,
        organizationId,
        empresaId,
      });
      console.log(`✅ Documento salvo com ID: ${savedDocument.id}`);

      return {
        success: true,
        message: 'Upload realizado com sucesso',
        documentId: savedDocument.id,
        file: {
          originalName: file.originalname,
          filename: file.filename,
          size: file.size,
          mimetype: file.mimetype,
          path: file.path,
        },
        extracted: {
          textLength: extractedText.length,
          text: extractedText.substring(0, 1000),
        },
        invoiceData,
        headers: {
          organizationId,
          empresaId,
        },
      };
    } catch (error) {
      console.error('❌ Erro no upload:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      };
    }
  }

  @Get()
  async listDocuments(
    @Headers('x-organization-id') organizationId: string,
  ) {
    console.log(`📋 Listando documentos para organização: ${organizationId}`);
    
    let documents = [];
    if (organizationId) {
      documents = await this.documentStorageService.getDocumentsByOrganization(organizationId);
    } else {
      documents = await this.documentStorageService.getAllDocuments();
    }

    return {
      success: true,
      total: documents.length,
      documents,
      message: documents.length === 0 ? 'Nenhum documento encontrado' : `${documents.length} documento(s) encontrado(s)`,
    };
  }

  @Get(':documentId')
  async getDocument(@Param('documentId') documentId: string) {
    console.log(`🔍 Buscando documento: ${documentId}`);
    const document = await this.documentStorageService.getDocument(documentId);

    if (!document) {
      return {
        success: false,
        error: 'Documento não encontrado',
      };
    }

    return {
      success: true,
      document,
    };
  }

  @Get(':documentId/status')
  async getDocumentStatus(@Param('documentId') documentId: string) {
    const document = await this.documentStorageService.getDocument(documentId);

    if (!document) {
      return {
        success: false,
        error: 'Documento não encontrado',
      };
    }

    return {
      success: true,
      documentId,
      status: document.status,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
