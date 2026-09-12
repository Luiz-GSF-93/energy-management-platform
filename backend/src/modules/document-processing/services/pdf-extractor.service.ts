import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PdfExtractorService {
  async extractText(buffer: Buffer): Promise<string> {
    try {
      console.log(`📖 === INICIANDO EXTRAÇÃO DE PDF ===`);
      console.log(`📦 Buffer size: ${buffer.length} bytes`);

      // Importar pdf-parse v2.4.5 corretamente
      const pdfParse = require('pdf-parse');
      
      console.log(`✓ pdf-parse v2.4.5 carregado`);

      // Executar parse com buffer
      console.log(`🔄 Fazendo parse do PDF...`);
      const data = await pdfParse(buffer);

      console.log(`✅ === PDF PROCESSADO COM SUCESSO ===`);
      console.log(`📄 Páginas: ${data.numpages}`);
      console.log(`📝 Texto extraído: ${(data.text?.length || 0)} caracteres`);
      
      if (data.info) {
        console.log(`📊 Metadados - Producer: "${data.info.Producer || 'N/A'}", Título: "${data.info.Title || 'N/A'}"`);
      }

      // Se tem texto significativo (>100 chars), retornar
      if (data.text && data.text.trim().length > 100) {
        console.log(`\n📄 === PRIMEIROS 2000 CARACTERES DO TEXTO ===\n`);
        console.log(data.text.substring(0, 2000));
        console.log(`\n--- FIM DA AMOSTRA ---\n`);
        return data.text;
      }

      // Se vazio ou muito curto, tentar OCR
      if (!data.text || data.text.trim().length === 0) {
        console.warn(`⚠️ PDF SEM CAMADA DE TEXTO (pode ser imagem ou protegido)`);
        console.log(`🔍 === INICIANDO OCR COM TESSERACT ===`);
        
        const ocrText = await this.extractWithTesseract(buffer);
        
        if (ocrText && ocrText.trim().length > 100) {
          console.log(`✅ OCR EXTRAIU ${ocrText.length} CARACTERES`);
          console.log(`\n📄 === TEXTO DO OCR (primeiros 2000 chars) ===\n`);
          console.log(ocrText.substring(0, 2000));
          console.log(`\n--- FIM ---\n`);
          return ocrText;
        }
        
        console.error(`❌ Nenhum texto extraído (PDF é imagem sem OCR disponível)`);
        return '';
      }

      // Se tem texto mas é curto
      console.warn(`⚠️ PDF extraiu apenas ${data.text.trim().length} caracteres`);
      console.log(`\n📄 === TEXTO COMPLETO ===\n`);
      console.log(data.text);
      console.log(`\n--- FIM ---\n`);
      
      return data.text;

    } catch (error) {
      console.error(`❌ === ERRO AO EXTRAIR PDF ===`);
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
      console.log(`🔍 === CONVERSÃO VISUAL PARA TEXTO COM TESSERACT.JS ===`);
      
      try {
        const Tesseract = require('tesseract.js');
        const sharp = require('sharp');
        
        console.log(`✓ Tesseract.js carregado`);
        console.log(`✓ Sharp carregado`);

        // Detectar tipo de arquivo
        const isPDF = buffer.toString('ascii', 0, 4) === '%PDF';
        console.log(`📄 Tipo: ${isPDF ? 'PDF (convertendo para imagem)' : 'Imagem direta'}`);

        let imagesToProcess: Buffer[] = [];

        // Se é PDF, converter primeira página para imagem
        if (isPDF) {
          console.log(`🔄 Convertendo PDF para imagem...`);
          try {
            // Usar pdfjs para extrair primeira página como imagem
            const pdfjsLib = require('pdfjs-dist');
            const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
            
            if (pdf.numPages > 0) {
              const page = await pdf.getPage(1);
              const viewport = page.getViewport({ scale: 2.0 });
              const canvas = require('canvas').createCanvas(viewport.width, viewport.height);
              const context = canvas.getContext('2d');
              
              await page.render({
                canvasContext: context,
                viewport: viewport
              }).promise;
              
              imagesToProcess.push(canvas.toBuffer('image/png'));
              console.log(`✓ Primeira página convertida`);
            }
          } catch (e) {
            console.warn(`⚠️ Não foi possível extrair imagem do PDF, tentando OCR direto no buffer`);
            // Fallback: tentar OCR no buffer como se fosse imagem
            imagesToProcess.push(buffer);
          }
        } else {
          // É imagem, usar diretamente
          imagesToProcess.push(buffer);
        }

        // Fazer OCR em cada imagem
        let fullText = '';
        
        for (let i = 0; i < imagesToProcess.length; i++) {
          console.log(`📸 Processando imagem ${i + 1}/${imagesToProcess.length}...`);
          
          try {
            const result = await Tesseract.recognize(imagesToProcess[i], 'por');
            const text = result.data.text;
            
            console.log(`  ✓ OCR extraiu ${text.length} caracteres da imagem ${i + 1}`);
            console.log(`  📊 Confiança: ${(result.data.confidence || 0).toFixed(2)}%`);
            
            fullText += text + '\n';
          } catch (ocrError) {
            console.warn(`⚠️ Erro ao fazer OCR na imagem ${i + 1}:`, 
              ocrError instanceof Error ? ocrError.message : ocrError
            );
          }
        }

        console.log(`✅ OCR CONCLUÍDO - Total: ${fullText.length} caracteres`);
        return fullText;

      } catch (libError) {
        console.error(`❌ Erro ao carregar bibliotecas:`, 
          libError instanceof Error ? libError.message : libError
        );
        console.warn(`⚠️ Tesseract.js ou Sharp não disponível`);
        console.warn(`   Instale com: npm install tesseract.js sharp canvas`);
        return '';
      }

    } catch (error) {
      console.error(`❌ Erro em OCR:`, error instanceof Error ? error.message : error);
      return '';
    }
  }
}
