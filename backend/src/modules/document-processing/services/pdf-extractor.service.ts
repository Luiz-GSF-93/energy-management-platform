import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    console.log('📖 === INICIANDO EXTRAÇÃO DE PDF ===');
    console.log(`📦 Buffer size: ${buffer.length} bytes`);

    try {
      // Strategy 1: pdf-parse
      console.log('🔄 Strategy 1: Tentando pdf-parse...');
      const textFromPdfParse = await this.extractWithPdfParse(buffer);
      
      if (textFromPdfParse && textFromPdfParse.trim().length > 100) {
        console.log(`✅ pdf-parse extraiu ${textFromPdfParse.length} caracteres`);
        console.log('\n📄 === PRIMEIROS 2000 CARACTERES ===\n');
        console.log(textFromPdfParse.substring(0, 2000));
        return textFromPdfParse;
      }

      // Strategy 2: pdfjs-dist
      console.log('🔄 Strategy 2: Tentando pdfjs-dist...');
      const textFromPdfjs = await this.extractWithPdfjs(buffer);
      
      if (textFromPdfjs && textFromPdfjs.trim().length > 100) {
        console.log(`✅ pdfjs-dist extraiu ${textFromPdfjs.length} caracteres`);
        console.log('\n📄 === PRIMEIROS 2000 CARACTERES ===\n');
        console.log(textFromPdfjs.substring(0, 2000));
        return textFromPdfjs;
      }

      // Strategy 3: OCR com Tesseract
      console.log('🔄 Strategy 3: Tentando OCR com Tesseract.js...');
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
      
      console.log(`  ✓ pdf-parse: ${data.numpages} páginas, ${data.text?.length || 0} chars`);
      return data.text || '';
    } catch (error) {
      console.warn('  ⚠️ pdf-parse falhou:', 
        error instanceof Error ? error.message : String(error)
      );
      return '';
    }
  }

  private async extractWithPdfjs(buffer: Buffer): Promise<string> {
    try {
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      
      let fullText = '';
      const maxPages = Math.min(pdf.numPages, 10);

      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        const pageText = text.items.map((item: any) => item.str || '').join(' ');
        fullText += pageText + '\n';
      }

      console.log(`  ✓ pdfjs-dist: ${pdf.numPages} páginas, ${fullText.length} chars`);
      return fullText;
    } catch (error) {
      console.warn('  ⚠️ pdfjs-dist falhou:', 
        error instanceof Error ? error.message : String(error)
      );
      return '';
    }
  }

  private async extractWithTesseract(buffer: Buffer): Promise<string> {
    try {
      console.log('  📖 Preparando Tesseract.js...');
      
      const Tesseract = require('tesseract.js');
      const sharp = require('sharp');
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

      // Converter primeira página do PDF para imagem
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const page = await pdf.getPage(1);
      
      const viewport = page.getViewport({ scale: 2 });
      const canvas = require('canvas').createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({
        canvasContext: ctx,
        viewport: viewport,
      }).promise;

      const imageData = canvas.toBuffer('image/png');
      console.log('  ✓ PDF convertido para imagem');

      // Executar OCR
      const { data: result } = await Tesseract.recognize(imageData, 'por', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            console.log(`  📊 OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      console.log(`  ✓ OCR concluído: ${result.text.length} chars`);
      return result.text;
    } catch (error) {
      console.warn('  ⚠️ OCR falhou:', 
        error instanceof Error ? error.message : String(error)
      );
      return '';
    }
  }
}
