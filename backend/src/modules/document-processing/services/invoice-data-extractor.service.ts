import { Injectable } from '@nestjs/common';

export interface ExtractedInvoiceData {
  invoiceNumber?: string;
  emissionDate?: string;
  referenceMonth?: string;
  dueDate?: string;
  clientName?: string;
  clientCnpj?: string;
  distributorName?: string;
  distributorCnpj?: string;
  consumerUnit?: string;
  consumptionKwh?: number;
  demandKw?: number;
  totalAmount?: number;
  currency?: string;
  rawText: string;
}

@Injectable()
export class InvoiceDataExtractorService {
  /**
   * Extrai dados estruturados do texto do PDF
   */
  extractData(pdfText: string): ExtractedInvoiceData {
    console.log('🔍 === INICIANDO EXTRAÇÃO DE DADOS ESTRUTURADOS ===\n');

    const data: ExtractedInvoiceData = {
      rawText: pdfText,
      currency: 'BRL',
    };

    try {
      // 1. Extrair Número da Nota Fiscal
      const nfMatch = pdfText.match(/(?:Número da NF|NF|Nota Fiscal)[\s:]*(\d+)/i);
      data.invoiceNumber = nfMatch ? nfMatch[1].trim() : undefined;
      console.log(`✓ NF: ${data.invoiceNumber || 'N/A'}`);

      // 2. Extrair Data de Emissão
      const emissionMatch = pdfText.match(/(?:Data de Emissão|Emissão)[\s:]*(\d{2}\/\d{2}\/\d{4})/i);
      data.emissionDate = emissionMatch ? emissionMatch[1].trim() : undefined;
      console.log(`✓ Data Emissão: ${data.emissionDate || 'N/A'}`);

      // 3. Extrair Período de Referência
      const periodMatch = pdfText.match(/(?:Período de Referência|Período|Mês)[\s:]*([A-Za-z]+\/\d{4}|\d{2}\/\d{4})/i);
      data.referenceMonth = periodMatch ? periodMatch[1].trim() : undefined;
      console.log(`✓ Período: ${data.referenceMonth || 'N/A'}`);

      // 4. Extrair Data de Vencimento
      const dueMatch = pdfText.match(/(?:Data de Vencimento|Vencimento)[\s:]*(\d{2}\/\d{2}\/\d{4})/i);
      data.dueDate = dueMatch ? dueMatch[1].trim() : undefined;
      console.log(`✓ Vencimento: ${data.dueDate || 'N/A'}`);

      // 5. Extrair Cliente (nome)
      const clientMatch = pdfText.match(/(?:CLIENTE|Cliente)[\s\n]+([\w\s\d]+?)(?:\n|R\s|\s\d{3})/i);
      data.clientName = clientMatch ? clientMatch[1].trim().substring(0, 100) : undefined;
      console.log(`✓ Cliente: ${data.clientName || 'N/A'}`);

      // 6. Extrair CNPJ Cliente
      const clientCnpjMatch = pdfText.match(/(?:CNPJ|CNPJ do Cliente)[\s:]*(\d{2}\.?\d{3}\.?\d{3}[/\\]?\d{4}[-\\]?\d{2})/);
      data.clientCnpj = clientCnpjMatch ? clientCnpjMatch[1].trim() : undefined;
      console.log(`✓ CNPJ Cliente: ${data.clientCnpj || 'N/A'}`);

      // 7. Extrair Distribuidora
      const distributorMatch = pdfText.match(/(COMPANHIA PAULISTA|CEMIG|LIGHT|ELETROPAULO|ENEL|ENERGISA|CELTINS|COELBA|COPEL|EDP|EQUATORIAL)/i);
      data.distributorName = distributorMatch ? distributorMatch[0].trim() : undefined;
      console.log(`✓ Distribuidora: ${data.distributorName || 'N/A'}`);

      // 8. Extrair Unidade Consumidora
      const ucMatch = pdfText.match(/(?:UC|Unidade Consumidora)[\s:]*(\d{1,3}\.?\d{3}\.?\d{3}\.?\d{3}[-\\]?\d{2})/i);
      data.consumerUnit = ucMatch ? ucMatch[1].trim() : undefined;
      console.log(`✓ UC: ${data.consumerUnit || 'N/A'}`);

      // 9. Extrair Consumo em kWh
      const consumptionMatch = pdfText.match(/(?:Total Consumo|Consumo Total)[\s:]*(\d+(?:[.,]\d+)?)\s*(?:kWh|kwh)/i);
      if (consumptionMatch) {
        data.consumptionKwh = parseFloat(consumptionMatch[1].replace('.', '').replace(',', '.'));
      }
      console.log(`✓ Consumo: ${data.consumptionKwh ? data.consumptionKwh + ' kWh' : 'N/A'}`);

      // 10. Extrair Demanda em kW
      const demandMatch = pdfText.match(/(?:Demanda|Demanda Contratada)[\s:]*(\d+(?:[.,]\d+)?)\s*(?:kW|KW)/i);
      if (demandMatch) {
        data.demandKw = parseFloat(demandMatch[1].replace('.', '').replace(',', '.'));
      }
      console.log(`✓ Demanda: ${data.demandKw ? data.demandKw + ' kW' : 'N/A'}`);

      // 11. Extrair Valor Total
      const totalMatch = pdfText.match(/(?:Total a Pagar|Valor Total|Total)[\s:]*R?\$?\s*(\d+(?:[.,]\d+)?)/);
      if (totalMatch) {
        data.totalAmount = parseFloat(totalMatch[1].replace('.', '').replace(',', '.'));
      }
      console.log(`✓ Total: ${data.totalAmount ? 'R$ ' + data.totalAmount.toFixed(2) : 'N/A'}`);

      console.log('\n✅ Extração de dados concluída!\n');
      return data;
    } catch (error) {
      console.error('❌ Erro ao extrair dados:', error);
      return data;
    }
  }

  /**
   * Valida se os dados extraídos formam uma fatura válida
   */
  validateInvoice(data: ExtractedInvoiceData): { isValid: boolean; score: number; errors: string[] } {
    const errors: string[] = [];
    let score = 0;

    console.log('✔️ === VALIDANDO FATURA ===\n');

    // Verificar campos obrigatórios
    if (data.invoiceNumber) {
      score += 20;
      console.log('✓ NF presente');
    } else {
      errors.push('Número da nota fiscal não encontrado');
    }

    if (data.emissionDate) {
      score += 15;
      console.log('✓ Data de emissão presente');
    } else {
      errors.push('Data de emissão não encontrada');
    }

    if (data.clientName) {
      score += 15;
      console.log('✓ Nome do cliente presente');
    } else {
      errors.push('Nome do cliente não encontrado');
    }

    if (data.consumptionKwh && data.consumptionKwh > 0) {
      score += 20;
      console.log('✓ Consumo válido');
    } else {
      errors.push('Consumo não encontrado ou inválido');
    }

    if (data.totalAmount && data.totalAmount > 0) {
      score += 20;
      console.log('✓ Valor total válido');
    } else {
      errors.push('Valor total não encontrado ou inválido');
    }

    if (data.referenceMonth) {
      score += 10;
      console.log('✓ Período presente');
    }

    const isValid = score >= 60 && errors.length === 0;

    console.log(`\n📊 Score: ${score}/100`);
    console.log(`✅ Válida: ${isValid ? 'SIM' : 'NÃO'}`);

    if (errors.length > 0) {
      console.log(`\n⚠️ Erros encontrados:`);
      errors.forEach(err => console.log(`  - ${err}`));
    }

    return { isValid, score, errors };
  }
}
