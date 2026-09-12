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
    console.log('🔍 Parseando fatura CPFL...');
    
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
      
      // NOVOS: Dados para auditoria
      clientCnpj: this.extractClientCnpj(text),
      clientName: this.extractClientName(text),
      distributorCnpj: this.extractDistributorCnpj(text),
      distributorName: this.extractDistributorName(text),
      consumerUnitNumber: this.extractConsumerUnitNumber(text),
      
      rawText: text.substring(0, 500),
    };

    console.log('✅ Fatura CPFL parseada:', {
      numero: data.invoiceNumber,
      clienteCnpj: data.clientCnpj,
      uc: data.consumerUnitNumber,
      consumo: data.consumptionKwh,
      total: data.totalAmount,
    });

    return data;
  }

  private extractInvoiceNumber(text: string): string {
    let match = text.match(/NOTA\s+FISCAL\s+N[ºO]?\s+(\d+)/i);
    if (match) return match[1];
    match = text.match(/NF[^\d]*(\d{9})/i);
    if (match) return match[1];
    return 'N/A';
  }

  private extractReferenceMonth(text: string): string {
    const months: Record<string, string> = {
      'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04',
      'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
      'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12',
    };

    for (const [monthAbbr, monthNum] of Object.entries(months)) {
      const pattern = new RegExp(`${monthAbbr}/2\\d{3}`, 'i');
      const match = text.match(pattern);
      if (match) {
        const [, year] = match[0].split('/');
        return `${year}-${monthNum}`;
      }
    }

    return new Date().toISOString().slice(0, 7);
  }

  private extractConsumption(text: string): number {
    const energiaMatch = text.match(/Energia\s+Ativa.*?kWh\s+([\d.,]+)/i);
    if (energiaMatch) return this.parseNumber(energiaMatch[1]);

    const consumoMatch = text.match(/(?:Consumo|CONSUMO).*?(\d+[\.,]\d+)\s*kWh/i);
    if (consumoMatch) return this.parseNumber(consumoMatch[1]);

    const numberMatches = text.match(/(\d{4,}[\.,]\d{2})/g);
    if (numberMatches && numberMatches.length > 0) {
      return this.parseNumber(numberMatches[0]);
    }

    return 0;
  }

  private extractDemand(text: string): number | undefined {
    const demandMatch = text.match(/Demanda\s+(?:Ativa|Ponta).*?kW\s+([\d.,]+)/i);
    if (demandMatch) return this.parseNumber(demandMatch[1]);
    return undefined;
  }

  private extractCharges(text: string): number {
    const chargesMatch = text.match(/(?:Encargos|TUSD|Uso\s+Sist.*Distr).*?R?\$?\s*([\d.,]+)/i);
    if (chargesMatch) return this.parseNumber(chargesMatch[1]);
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

    return total;
  }

  private extractTotal(text: string): number {
    let match = text.match(/Total\s+a\s+Pagar\s+R?\$?\s*([\d.,]+)/i);
    if (match) return this.parseNumber(match[1]);

    match = text.match(/Total\s+Distribuidora\s+([\d.,]+)/i);
    if (match) return this.parseNumber(match[1]);

    const bigNumbers = text.match(/R?\$?\s+(\d{2,}[\.,]\d{2})/g);
    if (bigNumbers && bigNumbers.length > 0) {
      return this.parseNumber(bigNumbers[bigNumbers.length - 1]);
    }

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
    if (match) return match[1].replace(/\./g, '').replace(/-/g, '');
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
