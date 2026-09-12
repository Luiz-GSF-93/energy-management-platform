import { Injectable } from '@nestjs/common';
import { SettlementEngine, SettlementInput, SettlementOutput } from './settlement.engine';
import { TariffConfig, AnnualProjection, ScenarioSimulation } from './tariff.config';

@Injectable()
export class CalculationService {
  constructor(private settlementEngine: SettlementEngine) {}

  /**
   * Calcula settlement com configuração de tarifa
   */
  calculateWithTariff(
    tariffConfig: TariffConfig,
    consumptionData: {
      consumptionPeakKwh: number;
      consumptionOffPeakKwh: number;
      demandPeakKw: number;
      demandOffPeakKw: number;
      generatorVolumeMwh: number;
    }
  ): SettlementOutput {
    const input: SettlementInput = {
      consumerUnitId: tariffConfig.consumerUnitId,
      referenceMonth: tariffConfig.referenceMonth,
      
      regulatedTusd: {
        consumptionPeakKwh: consumptionData.consumptionPeakKwh,
        consumptionOffPeakKwh: consumptionData.consumptionOffPeakKwh,
        demandPeakKw: consumptionData.demandPeakKw,
        demandOffPeakKw: consumptionData.demandOffPeakKw,
        tusdRatePeak: tariffConfig.regulated.tusd.peakRate,
        tusdRateOffPeak: tariffConfig.regulated.tusd.offPeakRate,
        demandRate: tariffConfig.regulated.tusd.demandRate,
      },
      
      regulatedTe: {
        consumptionPeakKwh: consumptionData.consumptionPeakKwh,
        consumptionOffPeakKwh: consumptionData.consumptionOffPeakKwh,
        teRatePeak: tariffConfig.regulated.te.peakRate,
        teRateOffPeak: tariffConfig.regulated.te.offPeakRate,
        additionalBandPeak: tariffConfig.regulated.additionalCharges?.bandeiraPeak,
        additionalBandOffPeak: tariffConfig.regulated.additionalCharges?.bandeiraOffPeak,
      },
      
      aclDistribution: {
        consumptionPeakTusdKwh: consumptionData.consumptionPeakKwh,
        consumptionOffPeakTusdKwh: consumptionData.consumptionOffPeakKwh,
        demandPeakKw: consumptionData.demandPeakKw,
        demandOffPeakKw: consumptionData.demandOffPeakKw,
        tusdRatePeak: tariffConfig.acl.distribution.tusdPeakRate,
        tusdRateOffPeak: tariffConfig.acl.distribution.tusdOffPeakRate,
        demandRate: tariffConfig.acl.distribution.demandRate,
        cdeCovid: tariffConfig.acl.distribution.cdeCovid,
        cdeWater: tariffConfig.acl.distribution.cdeWater,
      },
      
      aclCcee: {
        generatorVolumeMwh: consumptionData.generatorVolumeMwh,
        generatorRateMwhBrl: tariffConfig.acl.generator.ratePerMwh,
        contributionAssociative: tariffConfig.acl.ccee.associativeContribution,
        eer: tariffConfig.acl.ccee.eer,
        ercap: tariffConfig.acl.ccee.ercap,
        financialGuarantee: tariffConfig.acl.ccee.financialGuarantee,
        penalties: tariffConfig.acl.ccee.penalties,
        liquidationMcpCredit: tariffConfig.acl.ccee.liquidationMcp,
        nuclearQuotas: tariffConfig.acl.ccee.nuclearQuotas,
      },
      
      managementCosts: {
        model: tariffConfig.management.model,
        fixedMonthlyCost: tariffConfig.management.fixedMonthlyCost,
        percentageOnSavings: tariffConfig.management.percentageOnSavings,
      },
      
      taxes: {
        pisFederal: tariffConfig.taxes.pisFederal,
        cofinsFederal: tariffConfig.taxes.cofinsFederal,
        icmsStateRate: tariffConfig.taxes.icmsState,
      },
    };

    return this.settlementEngine.calculateSettlement(input);
  }

  /**
   * Projeta 12 meses de savings
   */
  projectAnnual(
    tariffConfig: TariffConfig,
    monthlyConsumption: { month: string; data: any }[]
  ): AnnualProjection {
    const monthlyData = monthlyConsumption.map(({ month, data }) => {
      const result = this.calculateWithTariff(tariffConfig, data);
      return {
        month,
        regulatedCost: result.regulatedTotalCost,
        aclCost: result.aclTotalCost,
        grossSavings: result.grossSavings,
        managementFee: result.managementFee,
        netSavings: result.netSavings,
      };
    });

    const totals = {
      regulatedCost: monthlyData.reduce((sum, m) => sum + m.regulatedCost, 0),
      aclCost: monthlyData.reduce((sum, m) => sum + m.aclCost, 0),
      grossSavings: monthlyData.reduce((sum, m) => sum + m.grossSavings, 0),
      managementFee: monthlyData.reduce((sum, m) => sum + m.managementFee, 0),
      netSavings: monthlyData.reduce((sum, m) => sum + m.netSavings, 0),
    };

    return {
      year: new Date().getFullYear(),
      monthlyData,
      totals,
      metrics: {
        averageSavingsPercentage: totals.regulatedCost > 0 
          ? (totals.grossSavings / totals.regulatedCost) * 100 
          : 0,
        totalRoi: totals.regulatedCost > 0
          ? (totals.netSavings / totals.regulatedCost) * 100
          : 0,
      },
    };
  }

  /**
   * Simula cenários (what-if)
   */
  simulateScenario(
    baseTariff: TariffConfig,
    scenario: ScenarioSimulation,
    consumption: any
  ): ScenarioSimulation {
    // Copiar e ajustar tarifas
    const adjustedTariff = JSON.parse(JSON.stringify(baseTariff));
    
    if (scenario.adjustments.tusdRatePeakAdjustment !== undefined) {
      adjustedTariff.regulated.tusd.peakRate *= (1 + scenario.adjustments.tusdRatePeakAdjustment / 100);
      adjustedTariff.acl.distribution.tusdPeakRate *= (1 + scenario.adjustments.tusdRatePeakAdjustment / 100);
    }
    
    if (scenario.adjustments.generatorRateAdjustment !== undefined) {
      adjustedTariff.acl.generator.ratePerMwh *= (1 + scenario.adjustments.generatorRateAdjustment / 100);
    }
    
    const adjustedConsumption = { ...consumption };
    if (scenario.adjustments.consumptionAdjustment !== undefined) {
      adjustedConsumption.consumptionPeakKwh *= (1 + scenario.adjustments.consumptionAdjustment / 100);
      adjustedConsumption.consumptionOffPeakKwh *= (1 + scenario.adjustments.consumptionAdjustment / 100);
    }
    
    const result = this.calculateWithTariff(adjustedTariff, adjustedConsumption);
    
    return {
      ...scenario,
      results: {
        regulatedCost: result.regulatedTotalCost,
        aclCost: result.aclTotalCost,
        savings: result.grossSavings,
        savingsPercentage: result.savingsPercentage,
      },
    };
  }
}
