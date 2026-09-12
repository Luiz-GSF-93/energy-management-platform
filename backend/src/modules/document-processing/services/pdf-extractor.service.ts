import { Injectable } from '@nestjs/common';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF (pdfjs-dist) ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Importar pdfjs-dist
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      
      console.log(`✓ pdfjs-dist carregado com sucesso`);

      // Configurar worker
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/legacy/build/pdf.worker.js');
        console.log(`✓ Worker PDF configurado`);
      } catch (e) {
        console.warn(`⚠️ Worker PDF não configurado, continuando sem ele`);
      }

      // Fazer parse do PDF
      console.log(`🔄 Iniciando parsing do PDF...`);
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      
      console.log(`📄 Total de páginas: ${pdf.numPages}`);

      let extractedText = '';
      let totalChars = 0;

      // Extrair texto de cada página
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          console.log(`📖 Processando página ${pageNum}/${pdf.numPages}...`);
          
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          // Concatenar items de texto
          const pageText = textContent.items
            .map((item: any) => {
              // Cada item tem propriedade 'str' com o texto
              return item.str || '';
            })
            .join(' ');
          
          extractedText += pageText + '\n';
          totalChars += pageText.length;
          
          console.log(`  ✓ Página ${pageNum}: ${pageText.length} caracteres`);
          
        } catch (pageError) {
          console.warn(`⚠️ Erro ao processar página ${pageNum}:`, 
            pageError instanceof Error ? pageError.message : pageError
          );
          continue;
        }
      }

      console.log(`✅ === PDF PROCESSADO COM SUCESSO ===`);
      console.log(`📝 Total de caracteres extraídos: ${totalChars}`);
      console.log(`📄 Páginas processadas: ${pdf.numPages}`);

      // Se tem texto significativo (>100 chars), retornar
      if (extractedText.trim().length > 100) {
        console.log(`\n📄 === PRIMEIROS 2000 CARACTERES DO TEXTO ===\n`);
        console.log(extractedText.substring(0, 2000));
        console.log(`\n--- FIM DA AMOSTRA ---\n`);
        return extractedText;
      }

      // Se vazio ou muito curto
      if (extractedText.trim().length === 0) {
        console.warn(`⚠️ PDF SEM TEXTO EXTRAÍVEL (pode ser imagem ou protegido)`);
        console.log(`🔍 Tentando OCR com Tesseract...`);
        const ocrText = await this.extractWithTesseract(buffer);
        
        if (ocrText && ocrText.length > 100) {
          console.log(`✅ OCR extraiu ${ocrText.length} caracteres`);
          return ocrText;
        }
        
        console.error(`❌ Nenhum texto extraído (PDF é imagem sem OCR implementado)`);
        return '';
      }

      // Tem texto mas é muito curto
      console.warn(`⚠️ PDF extraiu apenas ${extractedText.trim().length} caracteres`);
      console.log(`\n📄 === TEXTO EXTRAÍDO (${extractedText.length} chars) ===\n`);
      console.log(extractedText.substring(0, 1000));
      console.log(`\n--- FIM ---\n`);
      
      return extractedText;

    } catch (error) {
      console.error(`❌ === ERRO AO EXTRAIR PDF ===`);
      console.error(`Tipo de erro:`, error instanceof Error ? error.constructor.name : typeof error);
      
      if (error instanceof Error) {
        console.error(`📌 Mensagem: ${error.message}`);
        console.error(`📌 Stack completo:`);
        console.error(error.stack);
      } else {
        console.error(`📌 Erro (não é Error):`, error);
      }
      
      return '';
    }
  }

  private async extractWithTesseract(buffer: Buffer): Promise<string> {
    try {
      console.log(`🔍 === TENTANDO OCR COM TESSERACT.JS ===`);
      
      // Tentar importar tesseract.js se disponível
      try {
        const Tesseract = require('tesseract.js');
        console.log(`✓ Tesseract.js carregado`);
        
        // TODO: Implementar integração com Tesseract.js
        // Seria necessário:
        // 1. Converter PDF para imagens
        // 2. Fazer OCR de cada imagem
        // 3. Concatenar resultados
        
        console.warn(`⚠️ Tesseract.js não implementado ainda`);
        return '';
      } catch (e) {
        console.warn(`⚠️ Tesseract.js não instalado`);
        console.warn(`   Para implementar OCR, execute: npm install tesseract.js`);
        return '';
      }
    } catch (error) {
      console.error(`❌ Erro em OCR:`, error instanceof Error ? error.message : error);
      return '';
    }
  }
}
