export class CreateContractDto {
  contractNumber: string;
  customerId: string;
  contractTitle: string;
  description: string;
  monthlyFee: number;
  commissionPercentage: number;
  startDate: Date;
  endDate?: Date;
  contractType: string;
  terms?: string;
}

export class UpdateContractDto {
  contractTitle?: string;
  description?: string;
  monthlyFee?: number;
  commissionPercentage?: number;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TERMINATED';
  terms?: string;
}
