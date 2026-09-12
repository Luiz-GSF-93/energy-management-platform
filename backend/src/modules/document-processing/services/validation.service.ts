import { Injectable, Logger } from '@nestjs/common';
import { ConfidenceLevel } from '../enums/extraction-status.enum';

interface ValidationResult {
  isValid: boolean;
  issues: string[];
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
}

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  async validateExtractedData(data: any): Promise<ValidationResult> {
    const issues: string[] = [];
    let confidenceScore = 100;

    if (!data.invoiceNumber || data.invoiceNumber.toString().length < 3) {
      issues.push('❌ Número da fatura inválido');
      confidenceScore -= 20;
    }

    if (!data.referenceMonth || !/^\d{4}-\d{2}$/.test(data.referenceMonth)) {
      issues.push('❌ Período de referência inválido');
      confidenceScore -= 15;
    }

    if (!data.consumptionKwh || data.consumptionKwh <= 0) {
      issues.push('❌ Consumo em kWh inválido');
      confidenceScore -= 25;
    }

    if (!data.totalAmount || data.totalAmount <= 0) {
      issues.push('❌ Valor total inválido');
      confidenceScore -= 25;
    }

    let confidenceLevel: ConfidenceLevel;
    if (confidenceScore >= 95) {
      confidenceLevel = ConfidenceLevel.HIGH;
    } else if (confidenceScore >= 80) {
      confidenceLevel = ConfidenceLevel.MEDIUM;
    } else if (confidenceScore >= 60) {
      confidenceLevel = ConfidenceLevel.LOW;
    } else {
      confidenceLevel = ConfidenceLevel.CRITICAL_LOW;
    }

    this.logger.log(
      `📊 Validação: Score ${confidenceScore}% | Level ${confidenceLevel}`,
    );

    return {
      isValid: issues.length === 0,
      issues,
      confidenceScore: Math.max(0, confidenceScore),
      confidenceLevel,
    };
  }
}
