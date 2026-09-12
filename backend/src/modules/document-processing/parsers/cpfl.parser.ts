import { ParsedInvoiceData } from './energy-invoice.parser';
import { Distributor } from '../enums/distributor.enum';

export interface ExtendedInvoiceData extends ParsedInvoiceData {
  clientCnpj?: string;
  clientName?: string;
  distributorCnpj?: string;
  distributorName?: string;
  consumerUnitNumber?: string;
}

export class CpflParser {
  parse(text: string): ExtendedInvoiceData {
    console.log('🔍 CPFL Parser iniciado');
    console.log(`📝 Texto recebido: ${text.length} caracteres`);
    
    const data: ExtendedInvoiceData = {
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
      
      clientCnpj: this.extractClientCnpj(text),
      clientName: this.extractClientName(text),
      distributorCnpj: this.extractDistributorCnpj(text),
      distributorName: this.extractDistributorName(text),
      consumerUnitNumber: this.extractConsumerUnitNumber(text),
      
      rawText: text.substring(0, 500),
    };

    console.log('✅ CPFL Parser resultado:', {
      numero: data.invoiceNumber,
      mes: data.referenceMonth,
      consumo: data.consumptionKwh,
      total: data.totalAmount,
      clienteCnpj: data.clientCnpj,
      uc: data.consumerUnitNumber,
    });

    return data;
  }

  private extractInvoiceNumber(text: string): string {
    // CPFL: "NOTA FISCAL Nº 058824507"
    let match = text.match(/NOTA\s+FISCAL\s+N[ºO°]?\s+(\d+)/i);
    if (match) {
      console.log(`✅ Número fatura encontrado: ${match[1]}`);
      return match[1];
    }

    // Fallback: procura por números de 9 dígitos após "NF"
    match = text.match(/NF[^\d]*(\d{9})/i);
    if (match) {
      console.log(`✅ Número fatura (fallback): ${match[1]}`);
      return match[1];
    }

    console.log('⚠️ Número fatura não encontrado');
    return 'N/A';
  }

  private extractReferenceMonth(text: string): string {
    // Procura por "AGO/2026" ou "AGO 26"
    const monthPatterns = [
      { regex: /\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{4})/i, format: 'SLASH' },
      { regex: /\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{2})\b/i, format: 'SPACE' },
    ];

    const months: Record<string, string> = {
      'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04',
      'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
      'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12',
    };

    for (const pattern of monthPatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        const monthAbbr = match[1].toUpperCase();
        const monthNum = months[monthAbbr];
        const year = pattern.format === 'SLASH' ? match[2] : '20' + match[2];
        const result = `${year}-${monthNum}`;
        console.log(`✅ Mês de referência encontrado: ${result}`);
        return result;
      }
    }

    console.log('⚠️ Mês de referência não encontrado, usando mês atual');
    return new Date().toISOString().slice(0, 7);
  }

  private extractConsumption(text: string): number {
    // Procura por padrões de consumo
    const patterns = [
      /Energia\s+Ativa.*?kWh\s*([\d.,]+)/i,
      /ENERGIA\s+ATIVA[^\n]*\n[^\n]*(\d+[\.,]\d+)/i,
      /(?:Consumo|CONSUMO).*?(\d+[\.,]\d+)\s*kWh/i,
      /(\d{4,}[\.,]\d{1,2})\s+kWh/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = this.parseNumber(match[1]);
        if (value > 0) {
          console.log(`✅ Consumo encontrado: ${value} kWh`);
          return value;
        }
      }
    }

    console.log('⚠️ Consumo não encontrado');
    return 0;
  }

  private extractDemand(text: string): number | undefined {
    const patterns = [
      /Demanda\s+(?:Ativa|Ponta).*?kW\s+([\d.,]+)/i,
      /DEMANDA[^\n]*\n[^\n]*(\d+[\.,]\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = this.parseNumber(match[1]);
        if (value > 0) {
          console.log(`✅ Demanda encontrada: ${value} kW`);
          return value;
        }
      }
    }

    return undefined;
  }

  private extractCharges(text: string): number {
    const patterns = [
      /(?:Encargos|TUSD|Uso\s+Sist.*?Distr).*?R?\$?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return this.parseNumber(match[1]);
      }
    }
    return 0;
  }

  private extractTaxes(text: string): number {
    let total = 0;

    const icmsMatch = text.match(/ICMS\s+([\d.,]+)/);
    if (icmsMatch) total += this.parseNumber(icmsMatch[1]);

    const pisMatch = text.match(/PIS\/PASEP\s+([\d.,]+)/);
    if (pisMatch) total += this.parseNumber(pisMatch[1]);

    const cofinsMatch = text.match(/COFINS\s+([\d.,]+)/);
    if (cofinsMatch) total += this.parseNumber(cofinsMatch[1]);

    if (total > 0) {
      console.log(`✅ Impostos encontrados: R$ ${total.toFixed(2)}`);
    }
    return total;
  }

  private extractTotal(text: string): number {
    const patterns = [
      /Total\s+a\s+Pagar\s+R?\$?\s*([\d.,]+)/i,
      /TOTAL\s+A\s+PAGAR[^\n]*(\d+[\.,]\d+)/i,
      /Total\s+Distribuidora\s+([\d.,]+)/i,
      /(?:Total|TOTAL).*?R?\$?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = this.parseNumber(match[1]);
        if (value > 0) {
          console.log(`✅ Total encontrado: R$ ${value.toFixed(2)}`);
          return value;
        }
      }
    }

    console.log('⚠️ Total não encontrado');
    return 0;
  }

  private extractDueDate(text: string): string | undefined {
    const dueMatch = text.match(/Vencimento[:\s]+([\d]{2})\/(\d{2})\/(\d{4})/i);
    if (dueMatch) return `${dueMatch[3]}-${dueMatch[2]}-${dueMatch[1]}`;
    return undefined;
  }

  private extractIssueDate(text: string): string | undefined {
    const issueMatch = text.match(/(?:Data\s+de\s+)?Emissão[:\s]+([\d]{2})\/(\d{2})\/(\d{4})/i);
    if (issueMatch) return `${issueMatch[3]}-${issueMatch[2]}-${issueMatch[1]}`;
    return undefined;
  }

  private extractConsumerUnit(text: string): string | undefined {
    let match = text.match(/(?:Número\s+da\s+)?UC\s+([0-9.\-]+)/i);
    if (match) return match[1].replace(/\./g, '').replace(/-/g, '');
    return undefined;
  }

  private extractClientCnpj(text: string): string | undefined {
    const match = text.match(/CNPJ[:\s]+([0-9]{2}\.?[0-9]{3}\.?[0-9]{3}\/0001-?[0-9]{2})/i);
    if (match) {
      const cnpj = match[1].replace(/\./g, '').replace(/-/g, '');
      console.log(`✅ CNPJ Cliente encontrado: ${cnpj}`);
      return cnpj;
    }
    return undefined;
  }

  private extractClientName(text: string): string | undefined {
    const nameMatch = text.match(/(?:CNPJ|Razão Social)[:\s]*\n([A-Z][A-Z\s]+)\n/i);
    if (nameMatch) return nameMatch[1].trim();
    return undefined;
  }

  private extractDistributorCnpj(text: string): string | undefined {
    const match = text.match(/(?:Companhia|Empresa).*?([0-9]{2}\.?[0-9]{5}\.?[0-9]{3}\/0001-?[0-9]{2})/i);
    if (match) return match[1].replace(/\./g, '').replace(/-/g, '');
    return undefined;
  }

  private extractDistributorName(text: string): string | undefined {
    const match = text.match(/(CPFL|Eletropaulo|ENEL|Energisa|Neoenergia|Equatorial|CEMIG|Light|AES|COPEL)/i);
    if (match) return match[1];
    return undefined;
  }

  private extractConsumerUnitNumber(text: string): string | undefined {
    const match = text.match(/(?:Número\s+da\s+)?UC\s+([0-9]{1,}\.?[0-9]{1,}\.?[0-9]{1,}[\-\.][0-9]{1,})/i);
    if (match) return match[1];
    return undefined;
  }

  private parseNumber(value: string): number {
    const cleaned = value.trim().replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  }
}
