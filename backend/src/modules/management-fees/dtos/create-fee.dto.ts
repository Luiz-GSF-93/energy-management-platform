export class CreateFeeDto {
  contractId: string;
  referenceMonth: Date;
  baseFee: number;
  energySavings: number;
  savingsPercentage: number;
}

export class UpdateFeeDto {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  notes?: string;
}
