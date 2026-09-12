/**
 * Configuração de Tarifas - Permite ajuste de todos os componentes
 * Possibilita simulações e cenários diferentes
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
      bandeiraPeak?: number;            // R$
      bandeiraOffPeak?: number;         // R$
      other?: number;                   // R$
    };
  };

  // Mercado Livre - Distribuição
  acl: {
    distribution: {
      tusdPeakRate: number;             // R$/kWh
      tusdOffPeakRate: number;          // R$/kWh
      demandRate: number;               // R$/kW
      cdeCovid: number;                 // R$
      cdeWater: number;                 // R$
    };
    generator: {
      ratePerMwh: number;               // R$/MWh
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

  // Impostos (configuráveis por estado)
  taxes: {
    pisFederal: number;                 // %
    cofinsFederal: number;              // %
    icmsState: number;                  // %
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

/**
 * Projeção Anual - Agrupa 12 meses
 */
export interface AnnualProjection {
  year: number;
  monthlyData: {
    month: string;
    regulatedCost: number;
    aclCost: number;
    grossSavings: number;
    managementFee: number;
    netSavings: number;
  }[];
  totals: {
    regulatedCost: number;
    aclCost: number;
    grossSavings: number;
    managementFee: number;
    netSavings: number;
  };
  metrics: {
    averageSavingsPercentage: number;
    totalRoi: number;
  };
}

/**
 * Simulação de Cenários
 */
export interface ScenarioSimulation {
  id?: string;
  baseTariffId: string;
  name: string;
  description?: string;
  
  adjustments: {
    tusdRatePeakAdjustment?: number;    // % de mudança
    tusdRateOffPeakAdjustment?: number;
    generatorRateAdjustment?: number;
    consumptionAdjustment?: number;     // % de mudança no consumo
  };
  
  results: {
    regulatedCost: number;
    aclCost: number;
    savings: number;
    savingsPercentage: number;
  };
}
