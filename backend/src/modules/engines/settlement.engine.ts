import { Injectable, BadRequestException } from '@nestjs/common';

export interface SettlementInput {
  consumerUnitId: string;
  referenceMonth: Date;
  
  // Consumo
  consumptionMwh: number;
  
  // Mercado Regulado
  regulatedEnergyPrice: number;      // R$/MWh
  regulatedTusdCost: number;         // R$
  regulatedTaxes: number;            // R$
  
  // Mercado Livre
  contractedPrice: number;            // R$/MWh
  cceeCost: number;                  // R$
  chargesCost: number;               // R$
  taxesCost: number;                 // R$
  
  // Remuneração
  remunerationModel: 'FIXED' | 'HYBRID' | 'PERFORMANCE';
  fixedFee?: number;
  variablePercentage?: number;
  
  // Validações
  minConsumption?: number;
  maxConsumption?: number;
}

export interface SettlementOutput {
  referenceMonth: string;
  consumerUnitId: string;
  
  // Custos
  regulatedTotalCost: number;
  aclTotalCost: number;
  
  // Economia
  grossSavings: number;
  eligibleCosts: number;
  netSavings: number;
  
  // Remuneração
  managementFee: number;
  customerFinalSavings: number;
  
  // Métricas
  savingsPercentage: number;
  roi: number;
  
  // Breakdown (detalhes)
  breakdown: {
    regulatedEnergy: number;
    regulatedTusd: number;
    regulatedTaxes: number;
    aclEnergy: number;
    aclCcee: number;
    aclCharges: number;
    aclTaxes: number;
  };
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

@Injectable()
export class SettlementEngine {
  /**
   * Calcula a apuração mensal completa
   * Mercado Regulado vs Mercado Livre
   */
  calculateSettlement(input: SettlementInput): SettlementOutput {
    // 1. Validar input
    const validation = this.validateInput(input);
    if (!validation.isValid) {
      throw new BadRequestException(
        `Erro de validação: ${validation.errors.join(', ')}`
      );
    }

    // 2. Custo Mercado Regulado
    const regulatedTotalCost = this.calculateRegulatedCost(input);
    
    // 3. Custo Mercado Livre (ACL)
    const aclTotalCost = this.calculateAclCost(input);
    
    // 4. Economia Bruta
    const grossSavings = regulatedTotalCost - aclTotalCost;
    
    // 5. Custos Elegíveis (descontos)
    const eligibleCosts = this.calculateEligibleCosts(grossSavings);
    
    // 6. Economia Líquida para cálculo de honorário
    const netSavings = grossSavings - eligibleCosts;
    
    // 7. Remuneração Gestora
    const managementFee = this.calculateManagementFee(input, netSavings);
    
    // 8. Economia Final do Cliente
    const customerFinalSavings = Math.max(0, netSavings - managementFee);
    
    // 9. Métricas
    const savingsPercentage = regulatedTotalCost > 0 
      ? (grossSavings / regulatedTotalCost) * 100 
      : 0;
    const roi = regulatedTotalCost > 0
      ? (customerFinalSavings / regulatedTotalCost) * 100 
      : 0;
    
    return {
      referenceMonth: input.referenceMonth.toISOString().split('T')[0],
      consumerUnitId: input.consumerUnitId,
      regulatedTotalCost: this.round(regulatedTotalCost),
      aclTotalCost: this.round(aclTotalCost),
      grossSavings: this.round(grossSavings),
      eligibleCosts: this.round(eligibleCosts),
      netSavings: this.round(netSavings),
      managementFee: this.round(managementFee),
      customerFinalSavings: this.round(customerFinalSavings),
      savingsPercentage: this.round(savingsPercentage, 2),
      roi: this.round(roi, 2),
      breakdown: {
        regulatedEnergy: this.round(input.consumptionMwh * input.regulatedEnergyPrice),
        regulatedTusd: this.round(input.regulatedTusdCost),
        regulatedTaxes: this.round(input.regulatedTaxes),
        aclEnergy: this.round(input.consumptionMwh * input.contractedPrice),
        aclCcee: this.round(input.cceeCost),
        aclCharges: this.round(input.chargesCost),
        aclTaxes: this.round(input.taxesCost),
      },
    };
  }
  
  /**
   * Validar input
   */
  private validateInput(input: SettlementInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Consumo válido
    if (input.consumptionMwh < 0) {
      errors.push('Consumo não pode ser negativo');
    }
    if (input.consumptionMwh === 0) {
      warnings.push('Consumo é zero');
    }
    if (input.minConsumption && input.consumptionMwh < input.minConsumption) {
      errors.push(`Consumo abaixo do mínimo (${input.minConsumption} MWh)`);
    }
    if (input.maxConsumption && input.consumptionMwh > input.maxConsumption) {
      warnings.push(`Consumo acima do máximo (${input.maxConsumption} MWh)`);
    }
    
    // Preços válidos
    if (input.regulatedEnergyPrice < 0 || input.contractedPrice < 0) {
      errors.push('Preços de energia não podem ser negativos');
    }
    
    // Custos válidos
    if (input.regulatedTusdCost < 0 || input.cceeCost < 0) {
      errors.push('Custos não podem ser negativos');
    }
    
    // Remuneração válida
    if (input.remunerationModel === 'FIXED' && input.fixedFee === undefined) {
      errors.push('Modelo FIXED requer fixedFee');
    }
    if ((input.remunerationModel === 'HYBRID' || input.remunerationModel === 'PERFORMANCE') && 
        input.variablePercentage === undefined) {
      errors.push('Modelo HYBRID/PERFORMANCE requer variablePercentage');
    }
    if (input.variablePercentage !== undefined && (input.variablePercentage < 0 || input.variablePercentage > 100)) {
      errors.push('variablePercentage deve estar entre 0 e 100');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Calcula custo no mercado regulado
   */
  private calculateRegulatedCost(input: SettlementInput): number {
    const energyCost = input.consumptionMwh * input.regulatedEnergyPrice;
    return energyCost + input.regulatedTusdCost + input.regulatedTaxes;
  }
  
  /**
   * Calcula custo no mercado livre (ACL)
   */
  private calculateAclCost(input: SettlementInput): number {
    const energyCost = input.consumptionMwh * input.contractedPrice;
    return energyCost + input.cceeCost + input.chargesCost + input.taxesCost;
  }
  
  /**
   * Calcula custos elegíveis (tributos sobre economia)
   */
  private calculateEligibleCosts(grossSavings: number): number {
    // Apenas aplica tributação se houver economia positiva
    if (grossSavings <= 0) return 0;
    
    // 15% de tributação (IR + CSLL)
    const taxRate = 0.15;
    return grossSavings * taxRate;
  }
  
  /**
   * Calcula remuneração da gestora
   */
  private calculateManagementFee(input: SettlementInput, netSavings: number): number {
    // Não cobra se economia líquida é zero ou negativa
    if (netSavings <= 0) return 0;
    
    switch (input.remunerationModel) {
      case 'FIXED':
        return input.fixedFee ?? 0;
      
      case 'HYBRID':
        // Fixo + percentual sobre economia
        const fixed = input.fixedFee ?? 0;
        const variable = (netSavings * (input.variablePercentage ?? 0)) / 100;
        return fixed + variable;
      
      case 'PERFORMANCE':
        // Apenas percentual sobre economia
        return (netSavings * (input.variablePercentage ?? 0)) / 100;
      
      default:
        return 0;
    }
  }
  
  /**
   * Arredonda para 2 casas decimais
   */
  private round(value: number, decimals: number = 2): number {
    return parseFloat(value.toFixed(decimals));
  }
}
