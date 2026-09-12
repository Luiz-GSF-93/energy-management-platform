import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';

// Usar require com tipagem correta
const pdfParse = require('pdf-parse');

@Injectable()
export class PdfExtractorService {
  private readonly logger = new Logger(PdfExtractorService.name);

  async extractTextFromPdf(filePath: string): Promise<string> {
    try {
      const buffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(buffer);
      return pdfData.text || '';
    } catch (error) {
      this.logger.error(`Erro ao extrair PDF: ${error.message}`);
      return '';
    }
  }
}
