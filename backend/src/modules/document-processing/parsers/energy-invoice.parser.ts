import { Distributor } from '../enums/distributor.enum';
import { CpflParser } from './cpfl.parser';

export interface ParsedInvoiceData {
  organizationId?: string;
  empresaId?: string;
  invoiceNumber: string;
  referenceMonth: string;
  distributor: Distributor;
  consumptionKwh: number;
  demandKw?: number;
  chargesAmount: number;
  taxesAmount: number;
  totalAmount: number;
  dueDate?: string;
  issueDate?: string;
  consumerUnit?: string;
  rawText?: string;
  
  // NOVOS: Dados para auditoria
  clientCnpj?: string;
  clientName?: string;
  distributorCnpj?: string;
  distributorName?: string;
  consumerUnitNumber?: string;
}

export class EnergyInvoiceParser {
  private cpflParser = new CpflParser();

  parse(text: string, distributor: Distributor): ParsedInvoiceData {
    if (distributor === Distributor.CPFL) {
      return this.cpflParser.parse(text);
    }

    return this.parseGeneric(text, distributor);
  }

  private parseGeneric(text: string, distributor: Distributor): ParsedInvoiceData {
    const data: ParsedInvoiceData = {
      invoiceNumber: this.extractInvoiceNumber(text),
      referenceMonth: this.extractReferenceMonth(text),
      distributor,
      consumptionKwh: this.extractConsumption(text),
      demandKw: this.extractDemand(text),
      chargesAmount: this.extractCharges(text),
      taxesAmount: this.extractTaxes(text),
      totalAmount: this.extractTotal(text),
      dueDate: this.extractDueDate(text),
      issueDate: this.extractIssueDate(text),
      consumerUnit: this.extractConsumerUnit(text),
      rawText: text,
    };

    return data;
  }

  private extractInvoiceNumber(text: string): string {
    const patterns = [
      /fatura\s+n[º°]?\s*(\d+)/gi,
      /n[º°]\s+(?:da\s+)?fatura\s*:?\s*(\d+)/gi,
      /referência\s*:?\s*(\d+)/gi,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1] || 'N/A';
      }
    }
    return 'N/A';
  }

  private extractReferenceMonth(text: string): string {
    const patterns = [
      /(?:mês\s+de\s+)?referência\s*:?\s*(\d{1,2})\/(\d{4})/gi,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match.length >= 2) {
        const month = match[1].padStart(2, '0');
        const year = match[2];
        if (!isNaN(Number(month)) && !isNaN(Number(year))) {
          return `${year}-${month}`;
        }
      }
    }

    return new Date().toISOString().slice(0, 7);
  }

  private extractConsumption(text: string): number {
    const patterns = [
      /consumo\s*:?\s*([\d.,]+)\s*(?:kWh|kwh|kw\/h)/i,
      /energia\s+elétrica\s*:?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return this.parseNumber(match[1]);
      }
    }
    return 0;
  }

  private extractDemand(text: string): number | undefined {
    const pattern = /demanda\s*:?\s*([\d.,]+)\s*(?:kW|kw)/i;
    const match = text.match(pattern);
    return match ? this.parseNumber(match[1]) : undefined;
  }

  private extractCharges(text: string): number {
    const pattern = /encargos\s*:?\s*r?\$?\s*([\d.,]+)/i;
    const match = text.match(pattern);
    return match ? this.parseNumber(match[1]) : 0;
  }

  private extractTaxes(text: string): number {
    const patterns = [
      /impostos?\s*:?\s*r?\$?\s*([\d.,]+)/i,
      /icms\s*:?\s*r?\$?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return this.parseNumber(match[1]);
      }
    }
    return 0;
  }

  private extractTotal(text: string): number {
    const patterns = [
      /valor\s+total\s*:?\s*r?\$?\s*([\d.,]+)/i,
      /total\s+a\s+pagar\s*:?\s*r?\$?\s*([\d.,]+)/i,
      /total\s*:?\s*r?\$?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return this.parseNumber(match[1]);
      }
    }
    return 0;
  }

  private extractDueDate(text: string): string | undefined {
    const pattern = /vencimento\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
    const match = text.match(pattern);
    return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : undefined;
  }

  private extractIssueDate(text: string): string | undefined {
    const pattern = /emissão\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
    const match = text.match(pattern);
    return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : undefined;
  }

  private extractConsumerUnit(text: string): string | undefined {
    const patterns = [
      /u\.?c\.?\s*:?\s*(\d+)/i,
      /unidade\s+consumidora\s*:?\s*(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return undefined;
  }

  private parseNumber(value: string): number {
    const cleaned = value.trim().replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  }
}
