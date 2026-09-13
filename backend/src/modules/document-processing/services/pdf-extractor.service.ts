import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    console.log('📖 === INICIANDO EXTRAÇÃO DE PDF ===');
    console.log(`📦 Buffer size: ${buffer.length} bytes`);

    try {
      // Strategy 1: pdf-parse (função simples)
      console.log('🔄 Strategy 1: Tentando pdf-parse...');
      const textFromPdfParse = await this.extractWithPdfParse(buffer);
      
      if (textFromPdfParse && textFromPdfParse.trim().length > 100) {
        console.log(`✅ pdf-parse extraiu ${textFromPdfParse.length} caracteres`);
        console.log('\n📄 === PRIMEIROS 2000 CARACTERES ===\n');
        console.log(textFromPdfParse.substring(0, 2000));
        return textFromPdfParse;
      }

      console.warn('⚠️ pdf-parse não encontrou texto suficiente');
      return '';

    } catch (error) {
      console.error('❌ ERRO NA EXTRAÇÃO:', 
        error instanceof Error ? error.message : String(error)
      );
      return '';
    }
  }

  private async extractWithPdfParse(buffer: Buffer): Promise<string> {
    try {
      console.log('  📖 Carregando pdf-parse...');
      
      // Importar como função direta
      const pdf = require('pdf-parse/lib/pdf-parse.js');
      
      console.log(`  ✓ Tipo: ${typeof pdf}`);
      
      // Chamar a função pdf() com o buffer
      const data = await pdf(buffer);
      
      console.log(`  ✓ Páginas: ${data.numpages}`);
      console.log(`  ✓ Caracteres: ${data.text?.length || 0}`);
      
      if (data.info) {
        console.log(`  ✓ Producer: "${data.info.Producer || 'N/A'}"`);
      }
      
      return data.text || '';
    } catch (error) {
      console.warn('  ⚠️ pdf-parse falhou:', 
        error instanceof Error ? error.message : String(error)
      );
      return '';
    }
  }
}
