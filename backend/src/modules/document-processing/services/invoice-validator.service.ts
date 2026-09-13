import { Injectable } from '@nestjs/common';

@Injectable()
export class InvoiceValidatorService {
  /**
   * Valida se o texto extraído é realmente de uma fatura de energia
   */
  validateIsEnergyInvoice(extractedText: string): { 
    isValid: boolean; 
    confidence: number;
    keywords: string[];
  } {
    console.log('🔍 === VALIDANDO SE É FATURA DE ENERGIA ===');

    const keywordsToCheck = {
      distributor: [
        'cpfl', 'cemig', 'light', 'eletropaulo', 'enel', 'energisa',
        'enercaribe', 'ceb', 'coelba', 'cosern', 'copel', 'elektro',
        'ampla', 'edp', 'endesa', 'celtins', 'equatorial',
        'distribuidora', 'concessionária'
      ],
      invoiceTerms: [
        'fatura', 'nota fiscal', 'conta de energia', 'conta de luz',
        'consumo', 'kwh', 'tarifa', 'vencimento', 'referente',
        'período', 'cliente', 'matrícula', 'unidade consumidora',
        'número da fatura', 'ref.'
      ],
      charges: [
        'energia elétrica', 'demanda', 'impostos', 'icms', 'pis', 'cofins',
        'iluminação pública', 'bandeira tarifária', 'multa', 'juros'
      ]
    };

    const normalizedText = extractedText.toLowerCase();
    const foundKeywords: string[] = [];
    let totalScore = 0;

    // Verificar distribuidoras
    let distributorScore = 0;
    for (const keyword of keywordsToCheck.distributor) {
      if (normalizedText.includes(keyword)) {
        distributorScore += 25;
        foundKeywords.push(`DISTRIBUTOR: ${keyword}`);
      }
    }

    // Verificar termos de fatura
    let invoiceScore = 0;
    for (const keyword of keywordsToCheck.invoiceTerms) {
      if (normalizedText.includes(keyword)) {
        invoiceScore += 12;
        foundKeywords.push(`INVOICE_TERM: ${keyword}`);
      }
    }

    // Verificar cobranças
    let chargesScore = 0;
    for (const keyword of keywordsToCheck.charges) {
      if (normalizedText.includes(keyword)) {
        chargesScore += 8;
        foundKeywords.push(`CHARGE: ${keyword}`);
      }
    }

    totalScore = Math.min(100, distributorScore + invoiceScore + chargesScore);

    const isValid = totalScore >= 40; // Threshold mínimo

    console.log(`  ✓ Distributor Score: ${distributorScore}/25`);
    console.log(`  ✓ Invoice Terms Score: ${invoiceScore}/60`);
    console.log(`  ✓ Charges Score: ${chargesScore}/15`);
    console.log(`  📊 Total Confidence: ${totalScore}%`);
    console.log(`  ✓ Keywords encontradas: ${foundKeywords.length}`);
    foundKeywords.slice(0, 5).forEach(kw => console.log(`    - ${kw}`));
    
    if (!isValid) {
      console.warn(`  ⚠️ NÃO PARECE SER UMA FATURA DE ENERGIA VÁLIDA`);
    } else {
      console.log(`  ✅ VALIDADO COMO FATURA DE ENERGIA`);
    }

    return {
      isValid,
      confidence: totalScore,
      keywords: foundKeywords
    };
  }

  /**
   * Extrai campos numéricos principais de uma fatura
   */
  extractInvoiceFields(text: string): {
    invoiceNumber: string;
    referenceMonth: string;
    consumptionKwh: number;
    totalAmount: number;
  } {
    console.log('🔎 === EXTRAÇÃO DE CAMPOS ===');

    const normalizedText = text.toUpperCase();
    
    // Número da fatura (NF / NFe)
    const invoiceMatch = normalizedText.match(/(?:N[Oº]\.?\s*)?(?:NF|NFE|FATURA)[\s:]*(\d{4,20})/);
    const invoiceNumber = invoiceMatch ? invoiceMatch[1].trim() : 'N/A';

    // Mês de referência (formato: MMMM/YYYY ou MM/YYYY)
    const monthMatch = text.match(/(?:referent|período|mês de consumo|ref\.)[\s:]*([A-Za-z]+\/\d{4}|\d{2}\/\d{4})/i);
    const referenceMonth = monthMatch ? monthMatch[1].trim() : new Date().toISOString().slice(0, 7);

    // Consumo em kWh
    const consumptionMatch = normalizedText.match(/CONSUMO[\s:]*(\d+(?:[.,]\d+)?)\s*(?:KWH|K\s*W|K\/H)?/);
    const consumptionKwh = consumptionMatch ? parseFloat(consumptionMatch[1].replace(',', '.')) : 0;

    // Valor total
    const totalMatch = text.match(/(?:TOTAL|VALOR TOTAL|A PAGAR|VENCIMENTO|R\$)[\s:]*R?\$?\s*(\d+(?:[.,]\d+)?)/i);
    const totalAmount = totalMatch ? parseFloat(totalMatch[1].replace(',', '.')) : 0;

    console.log(`  ✓ Invoice: ${invoiceNumber}`);
    console.log(`  ✓ Mês: ${referenceMonth}`);
    console.log(`  ✓ Consumo: ${consumptionKwh} kWh`);
    console.log(`  ✓ Total: R$ ${totalAmount.toFixed(2)}`);

    return {
      invoiceNumber,
      referenceMonth,
      consumptionKwh,
      totalAmount
    };
  }
}
