import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Tentar com pdf-parse primeiro
      const pdfParse = require('pdf-parse');
      
      console.log(`🔄 Chamando pdfParse com buffer...`);
      const data = await pdfParse(buffer);

      console.log(`✅ === PDF PROCESSADO ===`);
      console.log(`📄 Páginas: ${data.numpages}`);
      console.log(`📝 Texto extraído: ${data.text?.length || 0} caracteres`);
      
      if (data.info) {
        console.log(`📊 Título: ${data.info.Title || 'N/A'}`);
        console.log(`👤 Autor: ${data.info.Author || 'N/A'}`);
      }

      // Se tem texto, retornar
      if (data.text && data.text.trim().length > 0) {
        console.log(`\n📄 === AMOSTRA DO TEXTO (primeiros 1500 chars) ===`);
        console.log(data.text.substring(0, 1500));
        console.log(`\n--- FIM DA AMOSTRA ---\n`);
        return data.text;
      }

      // Se não tem texto, tentar com pdfjs-dist
      console.warn(`⚠️ pdf-parse retornou vazio, tentando pdfjs-dist...`);
      const textFromPdfjs = await this.extractWithPdfjs(buffer);
      
      if (textFromPdfjs.length > 0) {
        console.log(`✅ pdfjs-dist extraiu ${textFromPdfjs.length} caracteres`);
        console.log(`\n📄 === TEXTO EXTRAÍDO COM PDFJS ===`);
        console.log(textFromPdfjs.substring(0, 1500));
        console.log(`\n--- FIM ---\n`);
        return textFromPdfjs;
      }

      console.error(`❌ Nenhum texto extraído com pdf-parse ou pdfjs-dist`);
      console.log(`📊 Estrutura do PDF:`, {
        numpages: data.numpages,
        hasText: !!(data.text?.length),
        version: data.version || 'N/A',
      });
      
      return '';
    } catch (error) {
      console.error(`❌ === ERRO AO EXTRAIR PDF ===`);
      console.error(`Erro:`, error);
      if (error instanceof Error) {
        console.error(`Mensagem: ${error.message}`);
      }
      return '';
    }
  }

  private async extractWithPdfjs(buffer: Buffer): Promise<string> {
    try {
      const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
      pdfjs.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/legacy/build/pdf.worker.js');

      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      let text = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        text += pageText + '\n';
      }

      return text;
    } catch (error) {
      console.error(`❌ Erro em pdfjs-dist:`, error);
      return '';
    }
  }
}
