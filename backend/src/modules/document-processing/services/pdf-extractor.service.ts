import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      const pdfParse = require('pdf-parse');
      
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);
      
      const data = await pdfParse(buffer);
      
      console.log(`✅ === PDF EXTRAÍDO COM SUCESSO ===`);
      console.log(`📄 Páginas: ${data.numpages}`);
      console.log(`📝 Caracteres: ${data.text.length}`);
      console.log(`📊 Info: ${JSON.stringify(data.info)}`);
      
      if (data.text.length > 0) {
        console.log(`\n📄 PRIMEIROS 1000 CARACTERES DO PDF:\n`);
        console.log(data.text.substring(0, 1000));
        console.log(`\n--- FIM DOS PRIMEIROS 1000 CARACTERES ---\n`);
      } else {
        console.error('❌ PDF extraído mas texto vazio!');
      }
      
      return data.text || '';
    } catch (error) {
      console.error('❌ Erro ao extrair PDF:', error);
      if (error instanceof Error) {
        console.error(`   Mensagem: ${error.message}`);
        console.error(`   Stack: ${error.stack}`);
      }
      return '';
    }
  }
}
