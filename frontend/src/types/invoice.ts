/**
 * Tipos para o módulo de Faturas de Energia
 */

export interface Invoice {
  id: string;
  organizationId: string;
  consumerUnitId: string;
  energyContractId: string;
  invoiceNumber: string;
  issueDate: Date | string;
  dueDate: Date | string;
  referenceMonth: Date | string;
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
  paidDate?: Date | string;

  // Documentos e observações
  invoiceUrl?: string;
  notes?: string;

  // Comparativa
  regulatedComparison?: number;
  marketComparison?: string;

  // Auditoria
  createdAt: Date | string;
  updatedAt: Date | string;
  createdBy: string;
}

export interface InvoiceAnalytics {
  total: number;
  issued: number;
  paid: number;
  pending: number;
  totalAmount: number;
  averageSavings: number;
  savingsPercentage: number;
}

export interface PerformanceMetrics {
  period: string;
  consumption: number;
  regulatedCost: number;
  freeMarketCost: number;
  savings: number;
  savingsPercentage: number;
  roi: number;
}

export interface InvoiceComparison {
  invoiceId: string;
  referenceMonth: Date | string;
  regulatedMarketTotal: number;
  freeMarketEstimated: number;
  potentialSavings: number;
  savingsPercentage: number;
  recommendation: string;
}
