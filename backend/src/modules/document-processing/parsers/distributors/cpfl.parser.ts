import { BaseDistributorParser } from './base-distributor.parser';
import { Distributor } from '../../enums/distributor.enum';
import { ParsedInvoiceData } from '../energy-invoice.parser';

export class CpflParser extends BaseDistributorParser {
  getDistributorName(): Distributor {
    return Distributor.CPFL;
  }

  matches(text: string): boolean {
    return text.includes('COMPANHIA PAULISTA DE FORÇA E LUZ') || 
           text.includes('Cia Paulista de Força Luz') ||
           text.includes('CPFL');
  }

  parse(text: string): ParsedInvoiceData {
    console.log(`📖 Parseando fatura CPFL...`);

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
      clientCnpj: this.extractClientCnpj(text),
      clientName: this.extractClientName(text),
      rawText: text,
    };

    console.log(`✅ Fatura CPFL parseada:`, {
      invoiceNumber: data.invoiceNumber,
      referenceMonth: data.referenceMonth,
      consumption: data.consumptionKwh,
      total: data.totalAmount,
      dueDate: data.dueDate,
    });

    return data;
  }

  private extractInvoiceNumber(text: string): string {
    const match = text.match(/NOTA\s+FISCAL\s+N[º°]\s+(\d+)/i);
    return match ? match[1] : 'N/A';
  }

  private extractReferenceMonth(text: string): string {
    const months: { [key: string]: string } = {
      'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04',
      'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
      'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12',
    };

    const match = text.match(/(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{4})/i);
    if (match) {
      const month = months[match[1].toUpperCase()];
      return `${match[2]}-${month}`;
    }

    const match2 = text.match(/(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{2})/i);
    if (match2) {
      const month = months[match2[1].toUpperCase()];
      const year = `20${match2[2]}`;
      return `${year}-${month}`;
    }

    return '2026-09';
  }

  private extractConsumption(text: string): number {
    const pontaMatch = text.match(/Ponta[^\d]*(\d+(?:[.,]\d+)?)/);
    const foraPontaMatch = text.match(/Fora de Ponta[^\d]*(\d+(?:[.,]\d+)?)/);

    let total = 0;
    if (pontaMatch) {
      total += parseFloat(pontaMatch[1].replace(',', '.'));
    }
    if (foraPontaMatch) {
      total += parseFloat(foraPontaMatch[1].replace(',', '.'));
    }

    return total;
  }

  private extractDemand(text: string): number | undefined {
    const match = text.match(/Demanda Ativa[^\d]*(\d+(?:[.,]\d+)?)/i);
    if (match) {
      return parseFloat(match[1].replace(',', '.'));
    }
    return undefined;
  }

  private extractCharges(text: string): number {
    const match = text.match(/(?:Subtotal|Total\s+Distribuidora)[^\d]*R?\$?\s*([\d.,]+)/i);
    if (match) {
      return parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
    }
    return 0;
  }

  private extractTaxes(text: string): number {
    let taxes = 0;

    const icmsMatch = text.match(/ICMS[^\d]*R?\$?\s*([\d.,]+)/i);
    if (icmsMatch) {
      taxes += parseFloat(icmsMatch[1].replace(/\./g, '').replace(',', '.'));
    }

    const pisMatch = text.match(/PIS\/PASEP[^\d]*R?\$?\s*([\d.,]+)/i);
    if (pisMatch) {
      taxes += parseFloat(pisMatch[1].replace(/\./g, '').replace(',', '.'));
    }

    const cofinsMatch = text.match(/COFINS[^\d]*R?\$?\s*([\d.,]+)/i);
    if (cofinsMatch) {
      taxes += parseFloat(cofinsMatch[1].replace(/\./g, '').replace(',', '.'));
    }

    return taxes;
  }

  private extractTotal(text: string): number {
    const match = text.match(/(?:Total\s+a\s+Pagar|Valor\s+(?:do\s+)?Documento)[^\d]*R?\$?\s*([\d.,]+)/i);
    if (match) {
      return parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
    }
    return 0;
  }

  private extractDueDate(text: string): string | undefined {
    const match = text.match(/Vencimento[^\d]*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (match) {
      return `${match[3]}-${match[2]}`;
    }
    return undefined;
  }

  private extractIssueDate(text: string): string | undefined {
    const match = text.match(/(?:Data\s+de|DATA\s+DE)\s+(?:Documento|EMISSÃO)[^\d]*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (match) {
      return `${match[3]}-${match[2]}`;
    }
    return undefined;
  }

  private extractConsumerUnit(text: string): string | undefined {
    const match = text.match(/(?:Número\s+da\s+UC|UC)\s+(\d+[\d.,\-]*)/i);
    if (match) {
      return match[1].trim();
    }
    return undefined;
  }

  private extractClientCnpj(text: string): string | undefined {
    const match = text.match(/CNPJ\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (match) {
      return match[1];
    }
    return undefined;
  }

  private extractClientName(text: string): string | undefined {
    const match = text.match(/DEL REI[^\n]*/);
    if (match) {
      return match[0].trim();
    }
    return undefined;
  }
}
