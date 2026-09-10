export interface ValidationError {
  field: string;
  code: string;
  message: string;
  value?: any;
}

export interface CalculationValidation {
  settlementId: string;
  energyContractId: string;
  organizationId: string;
  consumptionKwh: number;
  regulatedCost: number;
  aclCost: number;
  grossSavings: number;
  netSavings: number;
  honorarie: number;
  totalCost: number;
  finalValue: number;
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
  validatedAt: Date;
  validatedBy: string;
  metadata?: Record<string, any>;
  id?: string;
}

export interface ValidationResult {
  success: boolean;
  error?: string;
  validation?: CalculationValidation & { id?: string };
}
