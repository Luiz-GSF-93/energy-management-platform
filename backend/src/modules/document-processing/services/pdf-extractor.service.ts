import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Forma correta: pdf-parse pode estar como .default ou como módulo direto
      let pdfParse = require('pdf-parse');
      
      // Se for um objeto com propriedade default, usar ela
      if (typeof pdfParse !== 'function' && pdfParse.default) {
        pdfParse = pdfParse.default;
      }
      
      console.log(`🔄 Tipo de pdfParse: ${typeof pdfParse}`);

      if (typeof pdfParse !== 'function') {
        throw new Error(`pdf-parse não é uma função. Tipo: ${typeof pdfParse}`);
      }

      const data = await pdfParse(buffer);

      console.log(`✅ === PDF PROCESSADO COM SUCESSO ===`);
      console.log(`📄 Páginas: ${data.numpages}`);
      console.log(`📝 Texto extraído: ${data.text?.length || 0} caracteres`);
      
      if (data.info) {
        console.log(`📊 Título: "${data.info.Title || 'N/A'}"`);
        console.log(`👤 Autor: "${data.info.Author || 'N/A'}"`);
      }

      // Se tem texto, retornar
      if (data.text && data.text.trim().length > 0) {
        console.log(`\n📄 === PRIMEIROS 2000 CARACTERES DO TEXTO ===`);
        console.log(data.text.substring(0, 2000));
        console.log(`\n--- FIM DA AMOSTRA ---\n`);
        return data.text;
      }

      // Se vazio, tentar OCR com Tesseract
      console.warn(`⚠️ PDF sem camada de texto, tentando OCR com Tesseract...`);
      const ocrText = await this.extractWithTesseract(buffer);
      
      if (ocrText && ocrText.length > 0) {
        console.log(`✅ OCR extraiu ${ocrText.length} caracteres`);
        return ocrText;
      }

      console.error(`❌ Nenhum texto extraído (PDF pode ser imagem sem OCR)`);
      console.log(`📊 Info do PDF:`, {
        numpages: data.numpages,
        hasText: !!(data.text?.length),
        producer: data.info?.Producer || 'N/A',
      });
      
      return '';
    } catch (error) {
      console.error(`❌ === ERRO AO EXTRAIR PDF ===`);
      console.error(`Erro:`, error);
      if (error instanceof Error) {
        console.error(`Mensagem: ${error.message}`);
        console.error(`Stack:`, error.stack?.substring(0, 300));
      }
      return '';
    }
  }

  private async extractWithTesseract(buffer: Buffer): Promise<string> {
    try {
      console.log(`🔍 Tentando OCR com Tesseract...`);
      
      // Nota: Tesseract seria necessário para PDFs com imagem
      // Por enquanto, apenas registrar que seria necessário
      console.warn(`⚠️ OCR com Tesseract não implementado ainda (seria necessário para PDFs em imagem)`);
      
      return '';
    } catch (error) {
      console.error(`❌ Erro em OCR:`, error);
      return '';
    }
  }
}
