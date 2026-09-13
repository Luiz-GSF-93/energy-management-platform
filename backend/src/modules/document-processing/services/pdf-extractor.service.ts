import { Injectable } from '@nestjs/common';
import * as path from 'path';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    console.log('📖 === INICIANDO EXTRAÇÃO DE PDF ===');
    console.log(`📦 Buffer size: ${buffer.length} bytes`);
    
    try {
      // Importar pdfjs-dist
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
      const pdfjsLib = pdfjs.default;
      
      // ✅ Usar worker local (não CDN)
      const workerPath = path.join(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js')), 'pdf.worker.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
      
      // ✅ Converter Buffer para Uint8Array
      const uint8Array = new Uint8Array(buffer);
      
      // Fazer parse do PDF
      const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
      console.log(`✅ PDF carregado: ${pdf.numPages} páginas`);
      
      let fullText = '';
      
      // Extrair texto de cada página (máximo 10 páginas)
      const maxPages = Math.min(pdf.numPages, 10);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join('');
        fullText += pageText + '\n';
        console.log(`  ✓ Página ${i}: ${pageText.length} caracteres`);
      }
      
      console.log(`✅ Extração concluída: ${fullText.length} caracteres totais`);
      console.log(`📄 Primeiros 500 caracteres:\n${fullText.substring(0, 500)}\n`);
      
      return fullText;
    } catch (error) {
      console.error('❌ Erro na extração:', error instanceof Error ? error.message : String(error));
      return '';
    }
  }
}
