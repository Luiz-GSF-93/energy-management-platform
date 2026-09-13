import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    console.log('📖 === INICIANDO EXTRAÇÃO DE PDF ===');
    console.log(`📦 Buffer size: ${buffer.length} bytes`);

    try {
      // Strategy 1: pdf-parse (versão correta com PDFParse class)
      console.log('🔄 Strategy 1: Tentando pdf-parse com PDFParse class...');
      const textFromPdfParse = await this.extractWithPdfParse(buffer);
      
      if (textFromPdfParse && textFromPdfParse.trim().length > 100) {
        console.log(`✅ pdf-parse extraiu ${textFromPdfParse.length} caracteres`);
        console.log('\n📄 === PRIMEIROS 2000 CARACTERES ===\n');
        console.log(textFromPdfParse.substring(0, 2000));
        return textFromPdfParse;
      }

      console.warn('⚠️ pdf-parse não encontrou texto suficiente');
      console.log('🔄 Strategy 2: Tentando Tesseract.js para OCR...');
      const textFromOcr = await this.extractWithTesseract(buffer);
      
      if (textFromOcr && textFromOcr.trim().length > 100) {
        console.log(`✅ OCR extraiu ${textFromOcr.length} caracteres`);
        console.log('\n📄 === PRIMEIROS 2000 CARACTERES ===\n');
        console.log(textFromOcr.substring(0, 2000));
        return textFromOcr;
      }

      console.warn('⚠️ Nenhuma estratégia conseguiu extrair texto');
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
      console.log('  📖 Carregando pdf-parse com PDFParse class...');
      
      const pdfParseModule = require('pdf-parse');
      
      // pdf-parse exporta uma classe PDFParse
      if (typeof pdfParseModule.PDFParse !== 'function') {
        throw new Error('PDFParse não é uma função');
      }

      // Criar instância e processar
      const pdfParser = new pdfParseModule.PDFParse();
      await pdfParser.parseBuffer(buffer);
      
      console.log(`  ✓ Páginas: ${pdfParser.numpages}`);
      console.log(`  ✓ Caracteres: ${pdfParser.text?.length || 0}`);
      
      if (pdfParser.info) {
        console.log(`  ✓ Producer: "${pdfParser.info.Producer || 'N/A'}"`);
      }
      
      return pdfParser.text || '';
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
      
      // Tesseract.js espera uma imagem ou arquivo, tenta diretamente
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
