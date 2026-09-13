import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Usar require com dynamic require
      let pdfParse;
      try {
        pdfParse = require('pdf-parse');
        console.log(`✓ pdf-parse importado`);
        
        // Se for um objeto com propriedade default
        if (pdfParse && pdfParse.default) {
          pdfParse = pdfParse.default;
        }
        
        // Tenta chamar como função
        if (typeof pdfParse === 'function') {
          console.log(`✓ Executando pdfParse...`);
          const data = await pdfParse(buffer);
          
          console.log(`✅ === PDF EXTRAÍDO COM pdf-parse ===`);
          console.log(`📄 Páginas: ${data.numpages}`);
          console.log(`📝 Texto: ${data.text?.length || 0} caracteres`);
          
          if (data.text && data.text.trim().length > 50) {
            console.log(`\n📄 === PRIMEIROS 2000 CARACTERES ===\n`);
            console.log(data.text.substring(0, 2000));
            console.log(`\n--- FIM ---\n`);
            return data.text;
          }
        }
      } catch (e) {
        console.warn(`⚠️ pdf-parse falhou:`, e instanceof Error ? e.message : e);
      }

      // Fallback: Usar pdfjs-dist
      console.log(`🔄 Tentando com pdfjs-dist...`);
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      
      let extractedText = '';
      try {
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        console.log(`📄 Total de páginas: ${pdf.numPages}`);

        for (let i = 1; i <= pdf.numPages; i++) {
          try {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            const pageText = textContent.items
              .map((item: any) => item.str || '')
              .join(' ');
            
            extractedText += pageText + '\n';
            console.log(`  ✓ Página ${i}: ${pageText.length} caracteres`);
          } catch (pageErr) {
            console.warn(`⚠️ Erro na página ${i}:`, pageErr);
          }
        }

        console.log(`✅ === PDF EXTRAÍDO COM pdfjs-dist ===`);
        console.log(`📝 Total: ${extractedText.length} caracteres`);

        if (extractedText.trim().length > 50) {
          console.log(`\n📄 === PRIMEIROS 2000 CARACTERES ===\n`);
          console.log(extractedText.substring(0, 2000));
          console.log(`\n--- FIM ---\n`);
          return extractedText;
        }

      } catch (pdfErr) {
        console.error(`❌ pdfjs-dist também falhou:`, pdfErr);
      }

      console.warn(`⚠️ Nenhum texto foi extraído`);
      return extractedText || '';

    } catch (error) {
      console.error(`❌ === ERRO CRÍTICO NA EXTRAÇÃO ===`);
      if (error instanceof Error) {
        console.error(`📌 Mensagem: ${error.message}`);
        console.error(`📌 Stack:`, error.stack?.substring(0, 500));
      }
      return '';
    }
  }
}
