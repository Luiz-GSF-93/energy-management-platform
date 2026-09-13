import { Injectable } from '@nestjs/common';
import { CpflParser } from './cpfl.parser';
import { BaseDistributorParser } from './base-distributor.parser';
import { ParsedInvoiceData } from '../energy-invoice.parser';
import { Distributor } from '../../enums/distributor.enum';

@Injectable()
export class DistributorParserFactory {
  private parsers: BaseDistributorParser[] = [
    new CpflParser(),
  ];

  parse(text: string): ParsedInvoiceData {
    console.log(`🔍 === DETECTANDO DISTRIBUIDORA ===`);

    const parser = this.parsers.find(p => p.matches(text));

    if (parser) {
      console.log(`✅ Distribuidora detectada: ${parser.getDistributorName()}`);
      return parser.parse(text);
    }

    console.warn(`⚠️ Usando parser genérico`);
    
    return {
      invoiceNumber: 'N/A',
      referenceMonth: '2026-09',
      distributor: Distributor.GENERIC,
      consumptionKwh: 0,
      demandKw: undefined,
      chargesAmount: 0,
      taxesAmount: 0,
      totalAmount: 0,
      dueDate: undefined,
      issueDate: undefined,
      consumerUnit: undefined,
      clientCnpj: undefined,
      clientName: undefined,
      rawText: text,
    };
  }

  addParser(parser: BaseDistributorParser): void {
    this.parsers.push(parser);
    console.log(`✅ Parser adicionado: ${parser.getDistributorName()}`);
  }
}
