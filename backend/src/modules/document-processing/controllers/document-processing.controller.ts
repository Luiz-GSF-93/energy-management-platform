import { Controller, Post, Get, Param, UploadedFile, UseInterceptors, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { PdfExtractorService } from '../services/pdf-extractor.service';

type UploadedFileType = Express.Multer.File;

@Controller('document-processing')
export class DocumentProcessingController {
  constructor(private pdfExtractorService: PdfExtractorService) {}
  
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
      // Ler o arquivo do disco
      const fileBuffer = fs.readFileSync(file.path);
      console.log(`✅ Arquivo carregado: ${fileBuffer.length} bytes`);

      // Extrair texto do PDF
      let extractedText = '';
      if (file.mimetype === 'application/pdf') {
        console.log('\n🔄 Iniciando extração de texto do PDF...\n');
        extractedText = await this.pdfExtractorService.extractText(fileBuffer);
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
        extracted: {
          textLength: extractedText.length,
          text: extractedText.substring(0, 1000), // Primeiros 1000 caracteres
        },
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
