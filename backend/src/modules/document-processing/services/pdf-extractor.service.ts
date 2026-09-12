import { Injectable, Logger } from '@nestjs/common';
import * as pdf from 'pdf-parse';
import * as fs from 'fs';

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);

  async extractTextFromPdf(filePath: string): Promise<string> {
    try {
      const buffer = fs.readFileSync(filePath);
      const pdfData = await pdf(buffer);
      return pdfData.text || '';
    } catch (error) {
      this.logger.error(`Erro ao extrair PDF: ${error.message}`);
      return '';
    }
  }
}
