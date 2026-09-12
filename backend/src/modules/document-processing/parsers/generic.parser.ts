import { Injectable } from '@nestjs/common';
import { EnergyInvoiceParser, ParsedInvoiceData } from './energy-invoice.parser';
import { Distributor } from '../enums/distributor.enum';

@Injectable()
export class GenericParser {
  constructor(private energyParser: EnergyInvoiceParser) {}

  parse(text: string, distributor: Distributor): ParsedInvoiceData {
    // Por enquanto, usa o parser de energia para todas as faturas
    // No futuro, pode ter parsers específicos por distribuidor
    return this.energyParser.parse(text, distributor);
  }
}
