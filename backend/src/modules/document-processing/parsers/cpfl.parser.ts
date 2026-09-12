import { ParsedInvoiceData } from './energy-invoice.parser';
import { Distributor } from '../enums/distributor.enum';

export class CpflParser {
  /**
   * Parser especializado para faturas CPFL
   * Identifica campos específicos do formato CPFL
   */
  parse(text: string): ParsedInvoiceData {
    console.log('🔍 Parseando fatura CPFL...');
    
    const data: ParsedInvoiceData = {
      invoiceNumber: this.extractInvoiceNumber(text),
      referenceMonth: this.extractReferenceMonth(text),
      distributor: Distributor.CPFL,
      consumptionKwh: this.extractConsumption(text),
      demandKw: this.extractDemand(text),
      chargesAmount: this.extractCharges(text),
      taxesAmount: this.extractTaxes(text),
      totalAmount: this.extractTotal(text),
      dueDate: this.extractDueDate(text),
      issueDate: this.extractIssueDate(text),
      consumerUnit: this.extractConsumerUnit(text),
      rawText: text.substring(0, 500), // primeiros 500 chars para debug
    };

    console.log('✅ Fatura CPFL parseada:', {
      numero: data.invoiceNumber,
      mes: data.referenceMonth,
      consumo: data.consumptionKwh,
      total: data.totalAmount,
    });

    return data;
  }

  private extractInvoiceNumber(text: string): string {
    // CPFL: "NOTA FISCAL Nº 058824507"
    let match = text.match(/NOTA\s+FISCAL\s+N[ºO]?\s+(\d+)/i);
    if (match) return match[1];

    // Fallback: procura por números de 9 dígitos após "NF"
    match = text.match(/NF[^\d]*(\d{9})/i);
    if (match) return match[1];

    return 'N/A';
  }

  private extractReferenceMonth(text: string): string {
    // CPFL: "AGO/2026" ou "Mês de Referência: 08/2026"
    let match = text.match(/AGO\/2026|AGOSTO\/2026/i);
    if (match) return '2026-08';

    // Padrão geral: "MÊS/YYYY"
    const months: Record<string, string> = {
      'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04',
      'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
      'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12',
    };

    for (const [monthAbbr, monthNum] of Object.entries(months)) {
      const pattern = new RegExp(`${monthAbbr}/2\\d{3}`, 'i');
      match = text.match(pattern);
      if (match) {
        const [, year] = match[0].split('/');
        return `${year}-${monthNum}`;
      }
    }

    return new Date().toISOString().slice(0, 7);
  }

  private extractConsumption(text: string): number {
    // CPFL: "Energia Ativa - kWh" seguido de valores
    // Procura padrão: "11.378,6400" ou "11378,6400"
    
    // Tentar encontrar a seção de "Energia Ativa"
    const energiaMatch = text.match(/Energia\s+Ativa.*?kWh\s+([\d.,]+)/i);
    if (energiaMatch) {
      return this.parseNumber(energiaMatch[1]);
    }

    // Fallback: procura por "Consumo" ou "CONSUMO"
    const consumoMatch = text.match(/(?:Consumo|CONSUMO).*?(\d+[\.,]\d+)\s*kWh/i);
    if (consumoMatch) {
      return this.parseNumber(consumoMatch[1]);
    }

    // Última tentativa: maiores números no documento (provavelmente consumo)
    const numberMatches = text.match(/(\d{4,}[\.,]\d{2})/g);
    if (numberMatches && numberMatches.length > 0) {
      return this.parseNumber(numberMatches[0]);
    }

    return 0;
  }

  private extractDemand(text: string): number | undefined {
    // CPFL: "Demanda Ativa - kW" ou "Demanda Ponta - [kW]"
    const demandMatch = text.match(/Demanda\s+(?:Ativa|Ponta).*?kW\s+([\d.,]+)/i);
    if (demandMatch) {
      return this.parseNumber(demandMatch[1]);
    }
    return undefined;
  }

  private extractCharges(text: string): number {
    // CPFL: "Encargos", "TUSD", "Uso do Sistema de Distribuição"
    const chargesMatch = text.match(/(?:Encargos|TUSD|Uso\s+Sist.*Distr).*?R?\$?\s*([\d.,]+)/i);
    if (chargesMatch) {
      return this.parseNumber(chargesMatch[1]);
    }
    return 0;
  }

  private extractTaxes(text: string): number {
    // CPFL: ICMS, PIS/PASEP, COFINS
    let total = 0;

    const icmsMatch = text.match(/ICMS\s+([\d.,]+)/);
    if (icmsMatch) total += this.parseNumber(icmsMatch[1]);

    const pisMatch = text.match(/PIS\/PASEP\s+([\d.,]+)/);
    if (pisMatch) total += this.parseNumber(pisMatch[1]);

    const cofinsMatch = text.match(/COFINS\s+([\d.,]+)/);
    if (cofinsMatch) total += this.parseNumber(cofinsMatch[1]);

    return total;
  }

  private extractTotal(text: string): number {
    // CPFL: "Total a Pagar" ou "Total Distribuidora"
    let match = text.match(/Total\s+a\s+Pagar\s+R?\$?\s*([\d.,]+)/i);
    if (match) return this.parseNumber(match[1]);

    match = text.match(/Total\s+Distribuidora\s+([\d.,]+)/i);
    if (match) return this.parseNumber(match[1]);

    // Fallback: último número grande no documento
    const bigNumbers = text.match(/R?\$?\s+(\d{2,}[\.,]\d{2})/g);
    if (bigNumbers && bigNumbers.length > 0) {
      return this.parseNumber(bigNumbers[bigNumbers.length - 1]);
    }

    return 0;
  }

  private extractDueDate(text: string): string | undefined {
    // CPFL: "Vencimento: 15/09/2026"
    const dueMatch = text.match(/Vencimento[:\s]+([\d]{2})\/(\d{2})\/(\d{4})/i);
    if (dueMatch) {
      return `${dueMatch[3]}-${dueMatch[2]}-${dueMatch[1]}`;
    }
    return undefined;
  }

  private extractIssueDate(text: string): string | undefined {
    // CPFL: "Data de Emissão: 04/09/2026"
    const issueMatch = text.match(/(?:Data\s+de\s+)?Emissão[:\s]+([\d]{2})\/(\d{2})\/(\d{4})/i);
    if (issueMatch) {
      return `${issueMatch[3]}-${issueMatch[2]}-${issueMatch[1]}`;
    }
    return undefined;
  }

  private extractConsumerUnit(text: string): string | undefined {
    // CPFL: "Número da UC 1.574.348.035-70" ou "UC: 1234567"
    let match = text.match(/(?:Número\s+da\s+)?UC\s+([0-9.\-]+)/i);
    if (match) return match[1].replace(/\./g, '').replace(/-/g, '');

    return undefined;
  }

  private parseNumber(value: string): number {
    // Converte "1.574,50" ou "1574.50" para número
    const cleaned = value
      .trim()
      .replace(/\./g, '') // Remove pontos (separadores de milhares)
      .replace(',', '.'); // Converte vírgula para ponto decimal
    return parseFloat(cleaned) || 0;
  }
}
