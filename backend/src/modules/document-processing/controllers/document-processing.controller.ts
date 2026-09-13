import { Controller, Post, Get, Param, UploadedFile, UseInterceptors, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { PdfExtractorService } from '../services/pdf-extractor.service';
import { InvoiceDataExtractorService } from '../services/invoice-data-extractor.service';

type UploadedFileType = Express.Multer.File;

@Controller('document-processing')
export class DocumentProcessingController {
  constructor(
    private pdfExtractorService: PdfExtractorService,
    private invoiceDataExtractorService: InvoiceDataExtractorService,
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
        limits: { fileSize: 10 * 1024 * 1024 },
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
      let invoiceData = {};

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
  async listDocuments() {
    return {
      success: true,
      documents: [],
      message: 'Lista de documentos vazia',
    };
  }

  @Get(':documentId/status')
  async getDocumentStatus(@Param('documentId') documentId: string) {
    return {
      documentId,
      status: 'PENDING',
      message: `Verificando status do documento: ${documentId}`,
    };
  }
}
