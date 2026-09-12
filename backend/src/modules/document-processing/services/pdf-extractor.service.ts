import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Forma correta: pdf-parse default export
      const pdfParse = require('pdf-parse');
      
      console.log(`🔄 Chamando pdfParse com buffer...`);
      const data = await pdfParse(buffer);

      console.log(`✅ === PDF EXTRAÍDO COM SUCESSO ===`);
      console.log(`📄 Páginas: ${data.numpages}`);
      console.log(`📝 Caracteres extraídos: ${data.text?.length || 0}`);
      
      if (data.info) {
        console.log(`📊 Metadados: Title="${data.info.Title}" Author="${data.info.Author}"`);
      }

      if (data.text && data.text.length > 0) {
        console.log(`\n📄 === PRIMEIROS 1200 CARACTERES ===\n`);
        console.log(data.text.substring(0, 1200));
        console.log(`\n--- FIM DA AMOSTRA ---\n`);
        return data.text;
      } else {
        console.warn('⚠️ Nenhum texto extraído do PDF - pode ser imagem ou PDF protegido');
        console.log(`📊 Estrutura do PDF:`, {
          numpages: data.numpages,
          metadata: data.metadata || 'N/A',
          version: data.version || 'N/A',
        });
        return '';
      }
    } catch (error) {
      console.error('❌ === ERRO AO EXTRAIR PDF ===');
      console.error('Erro:', error);
      if (error instanceof Error) {
        console.error(`Mensagem: ${error.message}`);
        console.error(`Stack:`, error.stack?.substring(0, 500));
      }
      return '';
    }
  }
}
