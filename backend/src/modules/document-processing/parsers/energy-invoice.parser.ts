import { Distributor } from '../enums/distributor.enum';

export interface ParsedInvoiceData {
  organizationId?: string;
  empresaId?: string;
  invoiceNumber: string;
  referenceMonth: string; // YYYY-MM
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
}

export class EnergyInvoiceParser {
  /**
   * Extrai dados estruturados de uma fatura de energia
   */
  parse(text: string, distributor: Distributor): ParsedInvoiceData {
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
    // Padrão comum: "Fatura nº 123456", "Nº da Fatura: 789012"
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
    // Padrão: "Mês de referência: 09/2026" ou "Referência: setembro/2026"
    const patterns = [
      /(?:mês\s+de\s+)?referência\s*:?\s*(\d{1,2})\/(\d{4})/gi,
      /referência\s*:?\s*(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro).*?(\d{4})/gi,
    ];

    const monthMap: Record<string, string> = {
      janeiro: '01', fevereiro: '02', março: '03', abril: '04',
      maio: '05', junho: '06', julho: '07', agosto: '08',
      setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
    };

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

    // Fallback: tenta encontrar data no formato MM/YYYY
    const dateMatch = text.match(/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      return `${dateMatch[2]}-${dateMatch[1].padStart(2, '0')}`;
    }

    return new Date().toISOString().slice(0, 7); // Padrão: ano-mês atual
  }

  private extractConsumption(text: string): number {
    // Padrão: "Consumo: 450 kWh", "Energia Elétrica: 450"
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
    // Padrão: "Encargos: R$ 150,50"
    const pattern = /encargos\s*:?\s*r?\$?\s*([\d.,]+)/i;
    const match = text.match(pattern);
    return match ? this.parseNumber(match[1]) : 0;
  }

  private extractTaxes(text: string): number {
    // Padrão: "Impostos: R$ 45,23", "ICMS: R$ 35,10"
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
    // Padrão: "Total: R$ 595,73", "Valor Total: 595,73"
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
    // Padrão: "Vencimento: 25/09/2026"
    const pattern = /vencimento\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
    const match = text.match(pattern);
    return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : undefined;
  }

  private extractIssueDate(text: string): string | undefined {
    // Padrão: "Emissão: 05/09/2026"
    const pattern = /emissão\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
    const match = text.match(pattern);
    return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : undefined;
  }

  private extractConsumerUnit(text: string): string | undefined {
    // Padrão: "UC: 1234567", "Unidade Consumidora: 1234567"
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

  /**
   * Converte string numérica com . ou , para número
   */
  private parseNumber(value: string): number {
    // Remove espaços e converte . ou , para .
    const cleaned = value.trim().replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  }
}
