import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Importar pdf-parse de forma robusta
      let pdfParse = require('pdf-parse');
      
      // pdf-parse versão 2.x pode estar como default export
      if (typeof pdfParse !== 'function' && pdfParse.default && typeof pdfParse.default === 'function') {
        pdfParse = pdfParse.default;
        console.log(`✓ Usando pdfParse.default`);
      }
      
      console.log(`🔄 Tipo de pdfParse ANTES de usar: ${typeof pdfParse}`);
      console.log(`🔄 Chaves do objeto: ${Object.keys(pdfParse).join(', ')}`);

      if (typeof pdfParse !== 'function') {
        console.error(`❌ pdf-parse não é uma função!`);
        console.error(`   Tipo: ${typeof pdfParse}`);
        console.error(`   Valor: ${JSON.stringify(pdfParse)}`);
        throw new Error(
          `pdf-parse não é uma função. Tipo encontrado: ${typeof pdfParse}. ` +
          `Valor: ${JSON.stringify(pdfParse)}`
        );
      }

      console.log(`✓ pdf-parse é uma função, executando...`);
      const data = await pdfParse(buffer);

      console.log(`✅ === PDF PROCESSADO COM SUCESSO ===`);
      console.log(`📄 Páginas: ${data.numpages}`);
      console.log(`📝 Texto extraído: ${data.text?.length || 0} caracteres`);
      
      if (data.info) {
        console.log(`📊 Título: "${data.info.Title || 'N/A'}"`);
        console.log(`👤 Autor: "${data.info.Author || 'N/A'}"`);
        console.log(`🔖 Producer: "${data.info.Producer || 'N/A'}"`);
      }

      // Se tem texto significativo, retornar
      if (data.text && data.text.trim().length > 50) {
        console.log(`\n📄 === PRIMEIROS 2000 CARACTERES DO TEXTO ===\n`);
        console.log(data.text.substring(0, 2000));
        console.log(`\n--- FIM DA AMOSTRA ---\n`);
        return data.text;
      }

      // Se vazio ou muito curto, tentar OCR com Tesseract
      if (data.text && data.text.trim().length > 0 && data.text.trim().length <= 50) {
        console.warn(`⚠️ PDF tem apenas ${data.text.trim().length} caracteres (muito pouco)`);
      } else {
        console.warn(`⚠️ PDF sem camada de texto detectável`);
      }
      
      console.warn(`⚠️ Tentando OCR com Tesseract...`);
      const ocrText = await this.extractWithTesseract(buffer);
      
      if (ocrText && ocrText.length > 50) {
        console.log(`✅ OCR extraiu ${ocrText.length} caracteres`);
        return ocrText;
      }

      console.error(`❌ Nenhum texto extraído (PDF pode ser imagem sem OCR ou corrompido)`);
      console.log(`📊 Info do PDF:`, {
        numpages: data.numpages,
        textLength: data.text?.length || 0,
        producer: data.info?.Producer || 'N/A',
        version: data.version || 'N/A',
      });
      
      return '';
    } catch (error) {
      console.error(`❌ === ERRO AO EXTRAIR PDF ===`);
      console.error(`Erro completo:`, error);
      if (error instanceof Error) {
        console.error(`📌 Mensagem: ${error.message}`);
        console.error(`📌 Stack (primeiras 500 chars):`);
        console.error(error.stack?.substring(0, 500));
      }
      return '';
    }
  }

  private async extractWithTesseract(buffer: Buffer): Promise<string> {
    try {
      console.log(`🔍 === TENTANDO OCR COM TESSERACT ===`);
      
      // OCR será implementado aqui depois
      // Por enquanto, apenas placeholder
      console.warn(`⚠️ Tesseract.js não foi instalado ainda`);
      console.warn(`   Para implementar OCR, execute: npm install tesseract.js`);
      
      return '';
    } catch (error) {
      console.error(`❌ Erro em OCR:`, error);
      return '';
    }
  }
}
