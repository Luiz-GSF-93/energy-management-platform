/**
 * Interface completa de Fatura de Energia
 */
export interface Invoice {
  id: string;
  organizationId: string;
  consumerUnitId: string;
  energyContractId: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  referenceMonth: Date;
  status: 'draft' | 'issued' | 'paid' | 'cancelled';
  invoiceType: 'regulated' | 'free_market';

  // Concessionária
  distributorName: string;
  distributorCnpj: string;
  consumerUnitNumber: string;
  meterNumber: string;

  // Modalidade tarifária
  tariffModality: 'green' | 'blue' | 'white' | 'conventional';

  // Consumo
  consumptionKwhPeak: number;
  consumptionKwhOffPeak: number;
  totalConsumptionKwh: number;

  // Demanda
  demandKwPeak?: number;
  demandKwOffPeak?: number;
  demandKwBilled?: number;

  // Tarifas
  tusdEnergyRatePeak: number;
  tusdEnergyRateOffPeak: number;
  teEnergyRatePeak: number;
  teEnergyRateOffPeak: number;
  demandRatePeak?: number;
  demandRateOffPeak?: number;

  // Custos
  tusdEnergyCostPeak: number;
  tusdEnergyCostOffPeak: number;
  teEnergyCostPeak: number;
  teEnergyCostOffPeak: number;
  demandCostPeak?: number;
  demandCostOffPeak?: number;

  // Encargos
  reservedEnergyCost?: number;
  chargesCost?: number;
  municipalTax?: number;

  // Impostos
  icmsRate: number;
  icmsValue: number;
  pisRate: number;
  pisValue: number;
  cofinsRate: number;
  cofinsValue: number;

  // Crédito e descontos
  previousCredit?: number;
  discount?: number;
  fine?: number;
  interest?: number;

  // Totalizações
  subtotal: number;
  taxes: number;
  totalAmount: number;

  // Pagamento
  paidAmount?: number;
  paidDate?: Date;

  // Documentos e observações
  invoiceUrl?: string;
  notes?: string;

  // Comparativa
  regulatedComparison?: number;
  marketComparison?: string;

  // Auditoria
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/**
 * Simulação de mercado regulado
 */
export interface RegulatedMarketSimulation {
  consumerUnitId: string;
  referenceMonth: Date;
  consumptionKwhPeak: number;
  consumptionKwhOffPeak: number;
  demandKwPeak?: number;
  demandKwOffPeak?: number;
  
  tusdEnergyCostPeak: number;
  tusdEnergyCostOffPeak: number;
  teEnergyCostPeak: number;
  teEnergyCostOffPeak: number;
  demandCostPeak?: number;
  demandCostOffPeak?: number;
  
  icmsValue: number;
  pisValue: number;
  cofinsValue: number;
  chargesCost: number;
  
  subtotalBeforeTaxes: number;
  chargesTotal: number;
  totalEstimated: number;
}

/**
 * Comparação entre faturas
 */
export interface InvoiceComparison {
  invoiceId: string;
  referenceMonth: Date;
  regulatedMarketTotal: number;
  freeMarketEstimated: number;
  potentialSavings: number;
  savingsPercentage: number;
  recommendation: string;
}

/**
 * Métrica de performance (gráficos)
 */
export interface PerformanceMetrics {
  period: string; // YYYY-MM-DD
  consumption: number;
  regulatedCost: number;
  freeMarketCost: number;
  savings: number;
  savingsPercentage: number;
  roi: number;
}
