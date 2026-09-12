import { Injectable } from '@nestjs/common';
import { ConfidenceLevel } from '../enums/confidence-level.enum';
import { ParsedInvoiceData } from '../parsers/energy-invoice.parser';

@Injectable()
export class ValidationService {
  validateExtractedData(data: ParsedInvoiceData): {
    confidenceLevel: ConfidenceLevel;
    confidenceScore: number;
    notes: string[];
  } {
    let score = 100;
    const notes: string[] = [];

    // Validar campo por campo
    if (!data.invoiceNumber || data.invoiceNumber === 'N/A') {
      score -= 15;
      notes.push('Número de fatura não identificado');
    }

    if (!data.referenceMonth) {
      score -= 20;
      notes.push('Mês de referência não encontrado');
    }

    if (data.consumptionKwh === 0) {
      score -= 15;
      notes.push('Consumo não identificado');
    }

    if (data.totalAmount === 0) {
      score -= 15;
      notes.push('Valor total não identificado');
    }

    if (!data.consumerUnit) {
      score -= 10;
      notes.push('UC (Unidade Consumidora) não encontrada');
    }

    // Validar consistência
    if (data.chargesAmount + data.taxesAmount > data.totalAmount * 1.1) {
      score -= 10;
      notes.push('Soma de encargos e impostos inconsistente com o total');
    }

    // Definir nível de confiança
    let confidenceLevel: ConfidenceLevel;
    if (score >= 85) {
      confidenceLevel = ConfidenceLevel.HIGH;
    } else if (score >= 70) {
      confidenceLevel = ConfidenceLevel.MEDIUM;
    } else if (score >= 50) {
      confidenceLevel = ConfidenceLevel.LOW;
    } else {
      confidenceLevel = ConfidenceLevel.CRITICAL_LOW;
    }

    return {
      confidenceLevel,
      confidenceScore: score,
      notes,
    };
  }
}
