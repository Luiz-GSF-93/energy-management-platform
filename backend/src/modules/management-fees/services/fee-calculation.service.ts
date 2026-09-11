import { Injectable } from '@nestjs/common';
import { Contract } from '../../contracts/entities/contract.entity';

@Injectable()
export class FeeCalculationService {
  /**
   * Calcula comissão baseada em economia de energia
   * Comissão = Economia de Energia * (% de Comissão / 100)
   */
  calculateCommission(
    energySavings: number,
    commissionPercentage: number,
  ): number {
    return (energySavings * commissionPercentage) / 100;
  }

  /**
   * Calcula honorário total
   * Total = Honorário Base + Comissão
   */
  calculateTotalFee(baseFee: number, commission: number): number {
    return baseFee + commission;
  }

  /**
   * Calcula fee completo para um contrato
   */
  calculateFee(
    contract: Contract,
    baseFee: number,
    energySavings: number,
    savingsPercentage: number,
  ): {
    commission: number;
    totalFee: number;
  } {
    const commission = this.calculateCommission(
      energySavings,
      contract.commissionPercentage,
    );
    const totalFee = this.calculateTotalFee(baseFee, commission);

    return { commission, totalFee };
  }

  /**
   * Calcula economia média mensal
   */
  calculateMonthlySavings(
    previousCost: number,
    currentCost: number,
  ): number {
    return previousCost - currentCost;
  }

  /**
   * Calcula percentual de economia
   */
  calculateSavingsPercentage(
    previousCost: number,
    currentCost: number,
  ): number {
    if (previousCost === 0) return 0;
    return ((previousCost - currentCost) / previousCost) * 100;
  }
}
