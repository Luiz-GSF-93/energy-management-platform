/**
 * Configuração de Tarifas - Permite ajuste de todos os componentes
 */

export interface TariffConfig {
  id?: string;
  name: string;
  distributorId: string;
  consumerUnitId: string;
  referenceMonth: Date;
  status: 'ACTIVE' | 'DRAFT' | 'HISTORICAL';

  // Mercado Regulado
  regulated: {
    tusd: {
      peakRate: number;                 // R$/kWh
      offPeakRate: number;              // R$/kWh
      demandRate: number;               // R$/kW
    };
    te: {
      peakRate: number;                 // R$/kWh
      offPeakRate: number;              // R$/kWh
    };
    additionalCharges?: {
      bandeiraPeak?: number;
      bandeiraOffPeak?: number;
      other?: number;
    };
  };

  // Mercado Livre - Distribuição
  acl: {
    distribution: {
      tusdPeakRate: number;
      tusdOffPeakRate: number;
      demandRate: number;
      cdeCovid: number;
      cdeWater: number;
    };
    generator: {
      ratePerMwh: number;
    };
    ccee: {
      associativeContribution: number;
      eer: number;
      ercap: number;
      financialGuarantee: number;
      penalties: number;
      liquidationMcp: number;
      nuclearQuotas: number;
    };
  };

  // Impostos
  taxes: {
    pisFederal: number;
    cofinsFederal: number;
    icmsState: number;
  };

  // Modelo de Remuneração
  management: {
    model: 'FIXED' | 'HYBRID' | 'PERCENTAGE';
    fixedMonthlyCost?: number;
    percentageOnSavings?: number;
  };

  // Metadados
  createdAt?: Date;
  updatedAt?: Date;
  notes?: string;
}

export interface SettlementResult {
  referenceMonth: string;
  consumerUnitId: string;
  regulatedTotalCost: number;
  aclTotalCost: number;
  grossSavings: number;
  managementFee: number;
  netSavings: number;
  savingsPercentage: number;
  roi: number;
  regulatedBreakdown: {
    tusdEnergy: number;
    tusdDemand: number;
    teEnergy: number;
    teAdditional: number;
    subtotal: number;
    taxes: number;
    total: number;
  };
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
