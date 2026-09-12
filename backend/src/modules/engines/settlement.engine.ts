import { Injectable, BadRequestException } from '@nestjs/common';

/**
 * Interface para componentes de TUSD (Mercado Regulado)
 */
export interface TusdRegulatedComponents {
  consumptionPeakKwh: number;           // Consumo Ponta TUSD
  consumptionOffPeakKwh: number;        // Consumo Fora Ponta TUSD
  demandPeakKw: number;                 // Demanda Ponta TUSD
  demandOffPeakKw: number;              // Demanda Fora Ponta TUSD
  tusdRatePeak: number;                 // R$/kWh Ponta
  tusdRateOffPeak: number;              // R$/kWh Fora Ponta
  demandRate: number;                   // R$/kW
}

/**
 * Interface para componentes de TE (Transmissão - Mercado Regulado)
 */
export interface TeRegulatedComponents {
  consumptionPeakKwh: number;           // Consumo Ponta TE
  consumptionOffPeakKwh: number;        // Consumo Fora Ponta TE
  teRatePeak: number;                   // R$/kWh Ponta
  teRateOffPeak: number;                // R$/kWh Fora Ponta
  additionalBandPeak?: number;          // Adicional Bandeira Ponta
  additionalBandOffPeak?: number;       // Adicional Bandeira F. Ponta
}

/**
 * Interface para componentes do Mercado Livre (Distribuição)
 */
export interface DistributionAclComponents {
  consumptionPeakTusdKwh: number;       // Consumo Ponta TUSD
  consumptionOffPeakTusdKwh: number;    // Consumo Fora Ponta TUSD
  demandPeakKw: number;                 // Demanda Ponta
  demandOffPeakKw: number;              // Demanda Fora Ponta
  tusdRatePeak: number;                 // R$/kWh
  tusdRateOffPeak: number;              // R$/kWh
  demandRate: number;                   // R$/kW
  cdeCovid: number;                     // CDE-COVID (R$)
  cdeWater: number;                     // CDE Escassez Hídrica (R$)
  subsidyRate?: number;                 // Subvenção Tarifária (%)
}

/**
 * Interface para custos CCEE (Câmara de Comercialização de Energia Elétrica)
 */
export interface CceeAclCosts {
  generatorVolumeMwh: number;           // MWh volume
  generatorRateMwhBrl: number;          // R$/MWh
  contributionAssociative: number;      // Contribuição Associativa (R$)
  eer: number;                          // EER (R$)
  ercap: number;                        // ERCAP (R$)
  financialGuarantee: number;           // Aporte Garantia Financeira (R$)
  penalties: number;                    // Penalidades (R$)
  liquidationMcpCredit: number;         // Liquidação MCP - Crédito (R$)
  nuclearQuotas: number;                // COTAS E.NUCLEAR (R$)
}

/**
 * Interface para custos de administração
 */
export interface ManagementCosts {
  model: 'FIXED' | 'HYBRID' | 'PERCENTAGE';
  fixedMonthlyCost?: number;            // R$/mês
  percentageOnSavings?: number;         // %
  variableRateMwh?: number;             // R$/MWh (raro)
}

/**
 * Interface para impostos
 */
export interface TaxComponents {
  pisFederal: number;                   // PIS Federal (%)
  cofinsFederal: number;                // COFINS Federal (%)
  icmsStateRate: number;                // ICMS Estadual (%)
  irRate?: number;                      // IR (%)
  csllRate?: number;                    // CSLL (%)
}

/**
 * Input para cálculo completo - COMPATÍVEL COM VERSÃO ANTERIOR
 */
export interface SettlementInput {
  consumerUnitId: string;
  referenceMonth: Date;
  
  // Compatibilidade com versão anterior (simplificada)
  consumptionMwh?: number;              // MWh total (fallback)
  regulatedEnergyPrice?: number;        // R$/MWh (fallback)
  regulatedTusdCost?: number;           // R$ (fallback)
  regulatedTaxes?: number;              // R$ (fallback)
  contractedPrice?: number;             // R$/MWh (fallback)
  cceeCost?: number;                    // R$ (fallback)
  chargesCost?: number;                 // R$ (fallback)
  taxesCost?: number;                   // R$ (fallback)
  remunerationModel?: 'FIXED' | 'HYBRID' | 'PERFORMANCE';
  fixedFee?: number;
  variablePercentage?: number;
  minConsumption?: number;
  maxConsumption?: number;
  
  // Novos componentes detalhados
  regulatedTusd?: TusdRegulatedComponents;
  regulatedTe?: TeRegulatedComponents;
  aclDistribution?: DistributionAclComponents;
  aclCcee?: CceeAclCosts;
  managementCosts?: ManagementCosts;
  taxes?: TaxComponents;
}

/**
 * Output detalhado
 */
export interface SettlementOutput {
  referenceMonth: string;
  consumerUnitId: string;
  
  // Custos totais
  regulatedTotalCost: number;
  aclTotalCost: number;
  
  // Economia
  grossSavings: number;
  managementFee: number;
  netSavings: number;
  
  // Métricas
  savingsPercentage: number;
  roi: number;
  
  // Detalhamento Mercado Regulado
  regulatedBreakdown: {
    tusdEnergy: number;
    tusdDemand: number;
    teEnergy: number;
    teAdditional: number;
    subtotal: number;
    taxes: number;
    total: number;
  };
  
  // Detalhamento Mercado Livre
  aclBreakdown: {
    distributionTusd: number;
    distributionDemand: number;
    distributionCharges: number;
    generatorCost: number;
    cceeCosts: number;
    subtotal: number;
    taxes: number;
    total: number;
  };
}

@Injectable()
export class SettlementEngine {
  /**
   * Calcula apuração mensal completa com todos os componentes
   */
  calculateSettlement(input: SettlementInput): SettlementOutput {
    // 1. Calcular custos regulado
    const regulatedBreakdown = this.calculateRegulatedBreakdown(input);
    const regulatedTotalCost = regulatedBreakdown.total;
    
    // 2. Calcular custos ACL
    const aclBreakdown = this.calculateAclBreakdown(input);
    const aclTotalCost = aclBreakdown.total;
    
    // 3. Economia bruta
    const grossSavings = regulatedTotalCost - aclTotalCost;
    
    // 4. Remuneração da gestora
    const managementFee = this.calculateManagementFee(input, grossSavings);
    
    // 5. Economia líquida
    const netSavings = Math.max(0, grossSavings - managementFee);
    
    // 6. Métricas
    const savingsPercentage = regulatedTotalCost > 0 
      ? (grossSavings / regulatedTotalCost) * 100 
      : 0;
    const roi = regulatedTotalCost > 0
      ? (netSavings / regulatedTotalCost) * 100 
      : 0;
    
    return {
      referenceMonth: input.referenceMonth.toISOString().split('T')[0],
      consumerUnitId: input.consumerUnitId,
      regulatedTotalCost: this.round(regulatedTotalCost),
      aclTotalCost: this.round(aclTotalCost),
      grossSavings: this.round(grossSavings),
      managementFee: this.round(managementFee),
      netSavings: this.round(netSavings),
      savingsPercentage: this.round(savingsPercentage, 2),
      roi: this.round(roi, 2),
      regulatedBreakdown,
      aclBreakdown,
    };
  }

  /**
   * Detalha custos do Mercado Regulado
   */
  private calculateRegulatedBreakdown(input: SettlementInput) {
    let tusdEnergy = 0;
    let tusdDemand = 0;
    let teEnergy = 0;
    let teAdditional = 0;
    let subtotal = 0;

    // Se usa componentes detalhados
    if (input.regulatedTusd) {
      const { consumptionPeakKwh, consumptionOffPeakKwh, demandPeakKw, demandOffPeakKw, tusdRatePeak, tusdRateOffPeak, demandRate } = input.regulatedTusd;
      tusdEnergy = (consumptionPeakKwh * tusdRatePeak + consumptionOffPeakKwh * tusdRateOffPeak);
      tusdDemand = ((demandPeakKw + demandOffPeakKw) * demandRate);
    }

    if (input.regulatedTe) {
      const { consumptionPeakKwh, consumptionOffPeakKwh, teRatePeak, teRateOffPeak, additionalBandPeak = 0, additionalBandOffPeak = 0 } = input.regulatedTe;
      teEnergy = (consumptionPeakKwh * teRatePeak + consumptionOffPeakKwh * teRateOffPeak);
      teAdditional = (additionalBandPeak + additionalBandOffPeak);
    }

    // Fallback para interface antiga
    if (!input.regulatedTusd && !input.regulatedTe) {
      const mwh = input.consumptionMwh ?? 0;
      const price = input.regulatedEnergyPrice ?? 0;
      tusdEnergy = mwh * price;
      tusdDemand = input.regulatedTusdCost ?? 0;
      teEnergy = 0;
    }

    subtotal = tusdEnergy + tusdDemand + teEnergy + teAdditional;
    const taxes = this.calculateTaxes(subtotal, input.taxes, input.regulatedTaxes);
    const total = subtotal + taxes;

    return {
      tusdEnergy: this.round(tusdEnergy),
      tusdDemand: this.round(tusdDemand),
      teEnergy: this.round(teEnergy),
      teAdditional: this.round(teAdditional),
      subtotal: this.round(subtotal),
      taxes: this.round(taxes),
      total: this.round(total),
    };
  }

  /**
   * Detalha custos do Mercado Livre (ACL)
   */
  private calculateAclBreakdown(input: SettlementInput) {
    let distributionTusd = 0;
    let distributionDemand = 0;
    let distributionCharges = 0;
    let generatorCost = 0;
    let cceeCosts = 0;

    // Se usa componentes detalhados
    if (input.aclDistribution) {
      const { consumptionPeakTusdKwh, consumptionOffPeakTusdKwh, demandPeakKw, demandOffPeakKw, tusdRatePeak, tusdRateOffPeak, demandRate, cdeCovid = 0, cdeWater = 0 } = input.aclDistribution;
      distributionTusd = (consumptionPeakTusdKwh * tusdRatePeak + consumptionOffPeakTusdKwh * tusdRateOffPeak);
      distributionDemand = ((demandPeakKw + demandOffPeakKw) * demandRate);
      distributionCharges = cdeCovid + cdeWater;
    }

    if (input.aclCcee) {
      generatorCost = input.aclCcee.generatorVolumeMwh * input.aclCcee.generatorRateMwhBrl;
      cceeCosts = input.aclCcee.contributionAssociative +
                  input.aclCcee.eer +
                  input.aclCcee.ercap +
                  input.aclCcee.financialGuarantee +
                  input.aclCcee.penalties +
                  input.aclCcee.liquidationMcpCredit +
                  input.aclCcee.nuclearQuotas;
    }

    // Fallback para interface antiga
    if (!input.aclDistribution && !input.aclCcee) {
      const mwh = input.consumptionMwh ?? 0;
      const price = input.contractedPrice ?? 0;
      generatorCost = mwh * price;
      cceeCosts = (input.cceeCost ?? 0) + (input.chargesCost ?? 0);
      distributionTusd = 0;
      distributionDemand = 0;
      distributionCharges = 0;
    }

    const subtotal = distributionTusd + distributionDemand + distributionCharges + generatorCost + cceeCosts;
    const taxes = this.calculateTaxes(subtotal, input.taxes, input.taxesCost);
    const total = subtotal + taxes;

    return {
      distributionTusd: this.round(distributionTusd),
      distributionDemand: this.round(distributionDemand),
      distributionCharges: this.round(distributionCharges),
      generatorCost: this.round(generatorCost),
      cceeCosts: this.round(cceeCosts),
      subtotal: this.round(subtotal),
      taxes: this.round(taxes),
      total: this.round(total),
    };
  }

  /**
   * Calcula impostos (PIS + COFINS + ICMS)
   */
  private calculateTaxes(subtotal: number, taxes?: TaxComponents, fallbackTaxes?: number): number {
    // Usa fallback se não tiver componentes detalhados
    if (!taxes && fallbackTaxes !== undefined) {
      return fallbackTaxes;
    }
    
    if (!taxes) return 0;
    
    const pisRate = (taxes.pisFederal ?? 0) / 100;
    const cofinsRate = (taxes.cofinsFederal ?? 0) / 100;
    const icmsRate = (taxes.icmsStateRate ?? 0) / 100;
    
    // PIS e COFINS sobre base tributária
    const pisCofinsBase = subtotal;
    const pisCofins = pisCofinsBase * (pisRate + cofinsRate);
    
    // ICMS
    const icms = subtotal * icmsRate;
    
    return pisCofins + icms;
  }

  /**
   * Calcula remuneração da gestora
   */
  private calculateManagementFee(input: SettlementInput, grossSavings: number): number {
    // Prioridade: componente detalhado
    if (input.managementCosts) {
      const { model, fixedMonthlyCost = 0, percentageOnSavings = 0 } = input.managementCosts;
      
      switch (model) {
        case 'FIXED':
          return fixedMonthlyCost;
        
        case 'HYBRID':
          return fixedMonthlyCost + (grossSavings * percentageOnSavings / 100);
        
        case 'PERCENTAGE':
          return (grossSavings * percentageOnSavings / 100);
        
        default:
          return 0;
      }
    }

    // Fallback para interface antiga
    if (grossSavings <= 0) return 0;

    const model = input.remunerationModel ?? 'PERFORMANCE';
    const fixedFee = input.fixedFee ?? 0;
    const variablePercentage = input.variablePercentage ?? 0;

    switch (model) {
      case 'FIXED':
        return fixedFee;
      
      case 'HYBRID':
        return fixedFee + (grossSavings * variablePercentage / 100);
      
      case 'PERFORMANCE':
        return (grossSavings * variablePercentage / 100);
      
      default:
        return 0;
    }
  }

  /**
   * Arredonda valores
   */
  private round(value: number, decimals: number = 2): number {
    return parseFloat(value.toFixed(decimals));
  }
}
