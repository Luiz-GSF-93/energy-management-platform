import { Controller, Post, Get, Param, UploadedFile, UseInterceptors, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

// Usar Express.Multer.File em vez de multer.File
type UploadedFileType = Express.Multer.File;

@Controller('/api/v1/document-processing')
export class DocumentProcessingController {
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
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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
    return { documents: [] };
  }

  @Get(':documentId/status')
  getDocumentStatus(@Param('documentId') documentId: string) {
    return { documentId, status: 'PENDING' };
  }
}
