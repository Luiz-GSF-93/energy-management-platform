import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Importar pdf-parse corretamente do caminho exato
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      
      console.log(`✓ pdf-parse importado com sucesso`);
      console.log(`🔄 Tipo: ${typeof pdfParse}`);

      if (typeof pdfParse !== 'function') {
        throw new Error(
          `pdf-parse não é uma função. Tipo: ${typeof pdfParse}. ` +
          `Chaves: ${Object.keys(pdfParse).slice(0, 10).join(', ')}`
        );
      }

      console.log(`✓ Executando pdfParse com buffer de ${buffer.length} bytes...`);
      const data = await pdfParse(buffer);

      console.log(`✅ === PDF PROCESSADO COM SUCESSO ===`);
      console.log(`📄 Páginas: ${data.numpages}`);
      console.log(`📝 Texto extraído: ${(data.text?.length || 0)} caracteres`);
      
      if (data.info) {
        console.log(`📊 Metadados - Título: "${data.info.Title || 'N/A'}", Autor: "${data.info.Author || 'N/A'}", Producer: "${data.info.Producer || 'N/A'}"`);
      }

      // Se tem texto significativo (>100 chars), retornar
      if (data.text && data.text.trim().length > 100) {
        console.log(`\n📄 === PRIMEIROS 2000 CARACTERES DO TEXTO ===\n`);
        console.log(data.text.substring(0, 2000));
        console.log(`\n--- FIM DA AMOSTRA ---\n`);
        return data.text;
      }

      // Se vazio ou muito curto
      if (!data.text || data.text.trim().length === 0) {
        console.warn(`⚠️ PDF SEM TEXTO EXTRAÍVEL (pode ser imagem ou protegido)`);
        console.log(`📊 Info:`, {
          pages: data.numpages,
          textLength: data.text?.length || 0,
          producer: data.info?.Producer || 'N/A',
        });
        
        // Tentar OCR
        console.log(`🔍 Tentando OCR...`);
        const ocrText = await this.extractWithTesseract(buffer);
        if (ocrText && ocrText.length > 100) {
          console.log(`✅ OCR extraiu ${ocrText.length} caracteres`);
          return ocrText;
        }
        
        console.error(`❌ Nenhum texto extraído (PDF é imagem sem OCR implementado)`);
        return '';
      }

      // Tem texto mas é curto
      console.warn(`⚠️ PDF extraiu apenas ${data.text.trim().length} caracteres`);
      console.log(`\n📄 === TEXTO COMPLETO (${data.text.length} chars) ===\n`);
      console.log(data.text);
      console.log(`\n--- FIM ---\n`);
      
      return data.text;

    } catch (error) {
      console.error(`❌ === ERRO AO EXTRAIR PDF ===`);
      console.error(`Tipo de erro:`, error instanceof Error ? error.constructor.name : typeof error);
      
      if (error instanceof Error) {
        console.error(`📌 Mensagem: ${error.message}`);
        console.error(`📌 Stack:`, error.stack?.substring(0, 800));
      } else {
        console.error(`📌 Erro:`, error);
      }
      
      return '';
    }
  }

  private async extractWithTesseract(buffer: Buffer): Promise<string> {
    try {
      console.log(`🔍 === OCR COM TESSERACT.JS ===`);
      console.warn(`⚠️ Tesseract.js não implementado ainda`);
      console.warn(`   Para implementar OCR, execute: npm install tesseract.js`);
      return '';
    } catch (error) {
      console.error(`❌ Erro em OCR:`, error instanceof Error ? error.message : error);
      return '';
    }
  }
}
