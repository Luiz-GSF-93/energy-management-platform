export interface Scenario {
  id: string;
  name: string;
  description: string;
  adjustments: {
    tusdRatePeakAdjustment?: number;    // % de mudança
    tusdRateOffPeakAdjustment?: number;
    generatorRateAdjustment?: number;
    consumptionAdjustment?: number;
  };
}

export interface ScenarioResult {
  scenario: Scenario;
  regulatedCost: number;
  aclCost: number;
  savings: number;
  savingsPercentage: number;
  roi: number;
}
