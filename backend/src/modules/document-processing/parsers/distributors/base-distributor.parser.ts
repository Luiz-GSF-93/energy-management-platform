import { Distributor } from '../../enums/distributor.enum';
import { ParsedInvoiceData } from '../energy-invoice.parser';

export abstract class BaseDistributorParser {
  abstract getDistributorName(): Distributor;
  abstract matches(text: string): boolean;
  abstract parse(text: string): ParsedInvoiceData;

  protected extractValue(text: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return undefined;
  }

  protected extractNumericValue(text: string, patterns: RegExp[]): number {
    const value = this.extractValue(text, patterns);
    if (!value) return 0;
    
    const numeric = parseFloat(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
    return isNaN(numeric) ? 0 : numeric;
  }
}
