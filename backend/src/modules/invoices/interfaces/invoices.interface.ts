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
  invoiceType: 'regulated' | 'free_market' | 'adjustment';
  
  // Dados de consumo
  consumptionKwh: number;
  demandKw?: number;
  
  // Tarifas
  energyTariff: number; // R$/kWh
  demandTariff?: number; // R$/kW
  
  // Custos regulados
  energyCost: number; // consumptionKwh * energyTariff
  demandCost?: number;
  distributionCost: number;
  transmissionCost: number;
  
  // Encargos
  pis: number;
  cofins: number;
  icms: number;
  tusd: number; // Taxa de Uso do Sistema de Distribuição
  te: number; // Taxa de Energia
  
  // Subtotais
  subtotal: number;
  taxes: number;
  
  // Total
  totalAmount: number;
  
  // Pagamento
  paidAmount?: number;
  paidDate?: Date;
  
  // Metadata
  invoiceUrl?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface RegulatedMarketSimulation {
  consumerUnitId: string;
  referenceMonth: Date;
  
  // Dados de entrada
  consumptionKwh: number;
  demandKw?: number;
  
  // Tarifas base
  energyTariffsBase: {
    peakRate: number; // R$/kWh horário de pico
    offPeakRate: number; // R$/kWh horário fora de pico
    demandRate?: number; // R$/kW
  };
  
  // Cálculos
  energyCostCalculated: number;
  demandCostCalculated?: number;
  distributionCalculated: number;
  transmissionCalculated: number;
  
  // Encargos (% aplicados)
  pisPercentage: number;
  cofinsPercentage: number;
  icmsPercentage: number;
  tusdPercentage: number;
  tePercentage: number;
  
  // Totais
  subtotalBeforeTaxes: number;
  chargesTotal: number;
  totalEstimated: number;
  
  // Comparação
  comparison?: {
    currentBill: number;
    simulatedBill: number;
    savings: number;
    savingsPercentage: number;
  };
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  itemType: 'energy' | 'demand' | 'distribution' | 'transmission' | 'charge' | 'tax';
}

export interface InvoiceComparison {
  invoiceId: string;
  referenceMonth: Date;
  regulatedMarketTotal: number;
  freeMarketEstimated: number;
  potentialSavings: number;
  savingsPercentage: number;
  recommendation: string;
}
