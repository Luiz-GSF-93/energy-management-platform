import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO INTELIGENTE DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Detectar tipo de PDF
      const pdfType = this.detectPdfType(buffer);
      console.log(`📊 Tipo de PDF detectado: ${pdfType}`);

      let extractedText = '';

      // Strategy 1: Tentar pdf-parse (mais rápido para PDFs simples)
      if (pdfType === 'SIMPLE' || pdfType === 'UNKNOWN') {
        console.log(`🔄 Strategy 1: Tentando pdf-parse...`);
        extractedText = await this.extractWithPdfParse(buffer);
        
        if (extractedText && extractedText.trim().length > 100) {
          console.log(`✅ pdf-parse extraiu ${extractedText.length} caracteres`);
          return this.cleanAndFormatText(extractedText);
        }
      }

      // Strategy 2: Usar pdfjs-dist (melhor controle)
      console.log(`🔄 Strategy 2: Tentando pdfjs-dist com controle de páginas...`);
      extractedText = await this.extractWithPdfjs(buffer);
      
      if (extractedText && extractedText.trim().length > 100) {
        console.log(`✅ pdfjs-dist extraiu ${extractedText.length} caracteres`);
        return this.cleanAndFormatText(extractedText);
      }

      // Strategy 3: Fallback - processar como OCR (se implementado)
      console.log(`⚠️ Nenhuma estratégia extraiu texto significativo`);
      return extractedText;

    } catch (error) {
      console.error(`❌ === ERRO NA EXTRAÇÃO ===`);
      if (error instanceof Error) {
        console.error(`📌 ${error.message}`);
        console.error(`📌 Stack:`, error.stack?.substring(0, 500));
      }
      return '';
    }
  }

  /**
   * Detecta o tipo de PDF analisando sua estrutura
   */
  private detectPdfType(buffer: Buffer): string {
    try {
      const header = buffer.toString('ascii', 0, 100);
      
      // Verificar se é PDF protegido/criptografado
      if (header.includes('Encrypt')) {
        console.log(`  ⚠️ PDF protegido/criptografado detectado`);
        return 'PROTECTED';
      }
      
      // Verificar se é PDF com conteúdo complexo
      if (header.includes('Form') || header.includes('XObject')) {
        console.log(`  ℹ️ PDF com conteúdo complexo detectado`);
        return 'COMPLEX';
      }
      
      // Verificar se é PDF com imagens (pode ser scaneado)
      if (header.includes('Image') || header.includes('DCTDecode')) {
        console.log(`  ℹ️ PDF com imagens detectado`);
        return 'IMAGE_BASED';
      }

      console.log(`  ℹ️ PDF simples detectado`);
      return 'SIMPLE';
    } catch (e) {
      return 'UNKNOWN';
    }
  }

  /**
   * Strategy 1: Usar pdf-parse (rápido, simples)
   */
  private async extractWithPdfParse(buffer: Buffer): Promise<string> {
    try {
      console.log(`  📖 Carregando pdf-parse...`);
      
      const pdfParse = require('pdf-parse');
      console.log(`  ✓ Tipo: ${typeof pdfParse}`);

      const data = await pdfParse(buffer);
      
      console.log(`  ✓ Páginas: ${data.numpages}`);
      console.log(`  ✓ Texto: ${data.text?.length || 0} caracteres`);
      
      if (data.text && data.text.trim().length > 50) {
        console.log(`\n📄 === PRIMEIRO 1500 CHARS (pdf-parse) ===\n`);
        console.log(data.text.substring(0, 1500));
        console.log(`\n--- FIM ---\n`);
      }
      
      return data.text || '';
    } catch (error) {
      console.warn(`  ⚠️ pdf-parse falhou:`, 
        error instanceof Error ? error.message : error
      );
      return '';
    }
  }

  /**
   * Strategy 2: Usar pdfjs-dist (maior controle)
   */
  private async extractWithPdfjs(buffer: Buffer): Promise<string> {
    try {
      console.log(`  📖 Carregando pdfjs-dist...`);
      
      const pdfjsLib = require('pdfjs-dist');
      console.log(`  ✓ pdfjs-dist carregado`);

      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      console.log(`  ✓ Páginas: ${pdf.numPages}`);

      let fullText = '';
      const maxPages = Math.min(pdf.numPages, 50); // Limitar a 50 páginas

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          // Extrair texto preservando ordem
          const pageText = textContent.items
            .map((item: any) => item.str || '')
            .join(' ');
          
          fullText += pageText + '\n';
          console.log(`  ✓ Página ${pageNum}: ${pageText.length} chars`);
        } catch (pageError) {
          console.warn(`  ⚠️ Erro na página ${pageNum}`);
          continue;
        }
      }

      console.log(`  ✓ Total extraído: ${fullText.length} caracteres`);
      
      if (fullText.trim().length > 50) {
        console.log(`\n📄 === PRIMEIRO 1500 CHARS (pdfjs-dist) ===\n`);
        console.log(fullText.substring(0, 1500));
        console.log(`\n--- FIM ---\n`);
      }

      return fullText;
    } catch (error) {
      console.warn(`  ⚠️ pdfjs-dist falhou:`,
        error instanceof Error ? error.message : error
      );
      return '';
    }
  }

  /**
   * Limpar e formatar texto extraído
   */
  private cleanAndFormatText(text: string): string {
    if (!text) return '';

    return text
      // Remover quebras de linha excessivas
      .replace(/\n\n+/g, '\n')
      // Remover espaços excessivos
      .replace(/  +/g, ' ')
      // Trimmar
      .trim();
  }
}
