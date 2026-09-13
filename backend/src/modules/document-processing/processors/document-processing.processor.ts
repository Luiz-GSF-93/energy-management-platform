import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';

@Processor('document-processing')
@Injectable()
export class DocumentProcessingProcessor {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  @Process()
  async processDocument(job: Job<any>) {
    this.logger.log(`🔄 Processando Job ${job.id} - Documento: ${job.data.documentId}`);

    try {
      // Simular processamento
      this.logger.log(`📄 Processando arquivo: ${job.data.filePath}`);
      
      // Aqui você pode adicionar validações complexas, OCR, etc
      await new Promise(resolve => setTimeout(resolve, 2000));

      this.logger.log(`✅ Job ${job.id} concluído com sucesso`);
      
      return {
        success: true,
        documentId: job.data.documentId,
        processedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao processar Job ${job.id}:`, error);
      throw error;
    }
  }
}
