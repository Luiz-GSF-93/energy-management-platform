import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    console.log('📖 === INICIANDO EXTRAÇÃO DE PDF ===');
    console.log(`📦 Buffer size: ${buffer.length} bytes`);

    try {
      // Strategy 1: pdf-parse (rápido, sem dependências pesadas)
      console.log('🔄 Strategy 1: Tentando pdf-parse...');
      const textFromPdfParse = await this.extractWithPdfParse(buffer);
      
      if (textFromPdfParse && textFromPdfParse.trim().length > 100) {
        console.log(`✅ pdf-parse extraiu ${textFromPdfParse.length} caracteres`);
        console.log('\n📄 === PRIMEIROS 2000 CARACTERES ===\n');
        console.log(textFromPdfParse.substring(0, 2000));
        return textFromPdfParse;
      }

      // Strategy 2: OCR com Tesseract (para PDFs com imagem)
      console.log('⚠️ pdf-parse não encontrou texto suficiente');
      console.log('🔄 Strategy 2: Tentando OCR com Tesseract.js...');
      const textFromOcr = await this.extractWithTesseract(buffer);
      
      if (textFromOcr && textFromOcr.trim().length > 100) {
        console.log(`✅ OCR extraiu ${textFromOcr.length} caracteres`);
        console.log('\n📄 === PRIMEIROS 2000 CARACTERES ===\n');
        console.log(textFromOcr.substring(0, 2000));
        return textFromOcr;
      }

      console.warn('⚠️ Nenhuma estratégia conseguiu extrair texto significativo');
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
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      
      console.log(`  ✓ Páginas: ${data.numpages}`);
      console.log(`  ✓ Caracteres: ${data.text?.length || 0}`);
      
      if (data.info) {
        console.log(`  ✓ Producer: "${data.info.Producer || 'N/A'}"`);
        console.log(`  ✓ Title: "${data.info.Title || 'N/A'}"`);
      }
      
      return data.text || '';
    } catch (error) {
      console.warn('  ⚠️ pdf-parse falhou:', 
        error instanceof Error ? error.message : String(error)
      );
      return '';
    }
  }

  private async extractWithTesseract(buffer: Buffer): Promise<string> {
    try {
      console.log('  📖 Carregando Tesseract.js...');
      
      const Tesseract = require('tesseract.js');
      
      // Tentar OCR direto (funciona melhor com imagens)
      const { data: result } = await Tesseract.recognize(buffer, 'por', {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && m.progress > 0) {
            console.log(`  📊 OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      console.log(`  ✓ OCR concluído: ${result.text.length} caracteres`);
      return result.text;
    } catch (error) {
      console.warn('  ⚠️ OCR falhou:', 
        error instanceof Error ? error.message : String(error)
      );
      return '';
    }
  }
}
