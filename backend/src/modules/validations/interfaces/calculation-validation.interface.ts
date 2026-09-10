export interface ValidationError {
  field: string;
  code: string;
  message: string;
  value: any;
}

export interface CalculationValidation {
  id?: string;
  settlementId: string;
  energyContractId: string;
  organizationId: string;
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
  consumptionKwh: number;
  regulatedCost: number;
  aclCost: number;
  grossSavings: number;
  netSavings: number;
  honorarie: number;
  totalCost: number;
  finalValue: number;
  validatedAt: Date;
  validatedBy?: string;
  metadata?: Record<string, any>;
}

export interface ValidationResult {
  success: boolean;
  validation?: CalculationValidation;
  error?: string;
}
