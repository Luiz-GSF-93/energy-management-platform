import { Injectable } from '@nestjs/common';

export interface ParsedInvoice {
  invoiceNumber: string;
  referenceMonth: string;
  distributor: string;
  consumerUnit: string;
  consumptionKwh: number;
  energyCost: number;
  tusdCost?: number;
  icms: number;
  pis: number;
  cofins: number;
  totalAmount: number;
  items: Array<{ description: string; amount: number }>;
}

@Injectable()
export class GenericParser {
  parse(text: string): ParsedInvoice {
    return {
      invoiceNumber: this.extractString(text, /(?:Fatura|Invoice|Nº)[:\s]+(\d+)/i) || 'N/A',
      referenceMonth:
        this.extractDate(text, /(?:Período|Period)[:\s]+(\d{2}\/\d{2}\/\d{4})/i) ||
        new Date().toISOString().substring(0, 7),
      distributor: 'GENERIC',
      consumerUnit: this.extractString(text, /(?:UC|Consumer Unit)[:\s]+(\d+)/i) || 'N/A',
      consumptionKwh: this.extractNumber(text, /(?:Consumo|Consumption)[:\s]*(\d+[.,]\d+)\s*kWh/i) || 0,
      energyCost: this.extractNumber(text, /(?:Energia|Energy)[:\s]*R[\s]*\$?\s*([\d.,]+)/i) || 0,
      tusdCost: this.extractNumber(text, /TUSD[:\s]*R[\s]*\$?\s*([\d.,]+)/i),
      icms: this.extractNumber(text, /ICMS[:\s]*R[\s]*\$?\s*([\d.,]+)/i) || 0,
      pis: this.extractNumber(text, /PIS[:\s]*R[\s]*\$?\s*([\d.,]+)/i) || 0,
      cofins: this.extractNumber(text, /COFINS[:\s]*R[\s]*\$?\s*([\d.,]+)/i) || 0,
      totalAmount: this.extractNumber(text, /(?:Total|Total Amount)[:\s]*R[\s]*\$?\s*([\d.,]+)/i) || 0,
      items: [],
    };
  }

  private extractNumber(text: string, pattern: RegExp): number | null {
    const match = text.match(pattern);
    if (match) {
      const numStr = match[1].replace(/\./g, '').replace(',', '.');
      return parseFloat(numStr);
    }
    return null;
  }

  private extractString(text: string, pattern: RegExp): string | null {
    const match = text.match(pattern);
    return match ? match[1].trim() : null;
  }

  private extractDate(text: string, pattern: RegExp): string | null {
    const match = text.match(pattern);
    if (match) {
      const dateStr = match[1];
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}`;
      }
    }
    return null;
  }
}
