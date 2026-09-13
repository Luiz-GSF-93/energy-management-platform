import { Injectable } from '@nestjs/common';
import * as path from 'path';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    console.log('📖 === INICIANDO EXTRAÇÃO DE PDF ===');
    console.log(`📦 Buffer size: ${buffer.length} bytes`);
    
    try {
      // ✅ Importar pdfjs-dist corretamente
      const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
      console.log('✅ pdfjs-dist importado');
      
      // ✅ Usar worker local
      const workerPath = path.join(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js')), 'pdf.worker.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
      console.log('✅ Worker configurado');
      
      // ✅ Converter Buffer para Uint8Array
      const uint8Array = new Uint8Array(buffer);
      
      // Fazer parse do PDF
      const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;
      console.log(`✅ PDF carregado: ${pdf.numPages} páginas`);
      
      let fullText = '';
      
      // Extrair texto de cada página
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
      console.error(error);
      return '';
    }
  }
}
