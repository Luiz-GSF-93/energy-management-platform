import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      const pdfParse = require('pdf-parse');
      console.log(`📖 Iniciando extração de PDF (${buffer.length} bytes)...`);
      
      const data = await pdfParse(buffer);
      
      console.log(`✅ PDF extraído com sucesso:`);
      console.log(`   - Páginas: ${data.numpages}`);
      console.log(`   - Caracteres: ${data.text.length}`);
      console.log(`   - Primeiros 500 chars: ${data.text.substring(0, 500)}`);
      
      return data.text || '';
    } catch (error) {
      console.error('❌ Erro ao extrair PDF:', error);
      return '';
    }
  }
}
