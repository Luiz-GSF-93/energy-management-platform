export interface ManagementContract {
  id: string;
  organizationId: string;
  consumerUnitId: string;
  energyContractId: string;
  contractType: 'fixed' | 'percentage' | 'hybrid';
  status: 'active' | 'inactive' | 'expired' | 'terminated';
  
  // Remuneração Fixa
  monthlyFeeFixed?: number; // R$/mês
  setupFee?: number; // Taxa de implementação
  
  // Remuneração por Percentual
  percentageOfSavings?: number; // % dos savings (ex: 15%)
  percentageOfGrossSavings?: number; // % da economia bruta
  
  // Remuneração por Performance
  baseFee?: number; // Base mínima mensal
  incentivePercentage?: number; // % adicional se meta atingida
  targetSavings?: number; // Meta de economia em R$
  
  // Período
  startDate: Date;
  endDate?: Date;
  
  // Histórico
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface FeeCalculation {
  id: string;
  managementContractId: string;
  settlementId: string;
  referenceMonth: Date;
  
  // Base de cálculo
  grossSavings: number; // Economia bruta
  netSavings: number; // Economia líquida
  originalCost: number; // Custo original
  finalCost: number; // Custo após negociação
  
  // Tipos de remuneração calculados
  fixedFee?: number;
  performanceFee?: number;
  percentageFee?: number;
  incentiveFee?: number;
  
  // Total
  totalFee: number;
  feePercentageOfSavings?: number;
  
  // Status
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  approvedBy?: string;
  approvedAt?: Date;
  paidAt?: Date;
  
  // Metadata
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeeComparison {
  settlementId: string;
  referenceMonth: Date;
  grossSavings: number;
  
  // Cenários de remuneração
  fixedFeeScenario: {
    monthlyFee: number;
    setupFee?: number;
    total: number;
  };
  
  percentageFeeScenario: {
    percentage: number;
    baseAmount: number;
    calculatedFee: number;
  };
  
  hybridFeeScenario: {
    fixedComponent: number;
    variableComponent: number;
    total: number;
    percentageOfSavings: number;
  };
  
  recommendation: string;
}

export interface HonoraryPayout {
  id: string;
  organizationId: string;
  consumerUnitId: string;
  referenceMonth: Date;
  
  // Composição
  feeCalculations: FeeCalculation[];
  totalAmount: number;
  
  // Pagamento
  status: 'pending' | 'approved' | 'scheduled' | 'paid' | 'failed';
  dueDate: Date;
  paidDate?: Date;
  paymentMethod?: 'bank_transfer' | 'credit' | 'check';
  
  // Metadata
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeeRule {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  
  // Regra
  ruleType: 'fixed' | 'percentage' | 'tiered' | 'performance';
  parameters: Record<string, any>;
  
  // Aplicação
  applicableFrom: Date;
  applicableTo?: Date;
  priority: number;
  
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
