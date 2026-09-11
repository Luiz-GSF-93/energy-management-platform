export interface Contract {
  id: string;
  contractNumber: string;
  contractTitle: string;
  monthlyFee: number;
  commissionPercentage: number;
  startDate: string;
  endDate?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  contractType: 'STANDARD' | 'PREFERENCIAL';
  customerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Fee {
  id: string;
  contractId: string;
  referenceMonth: string;
  baseFee: number;
  energySavings: number;
  savingsPercentage: number;
  commission: number;
  totalFee: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  feeId: string;
  approverName: string;
  approverEmail: string;
  status: 'APPROVED' | 'REJECTED';
  comments: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractAnalytics {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  totalValue: number;
}

export interface FeeAnalytics {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  paid: number;
  totalValue: number;
  approvedValue: number;
  paidValue: number;
}

export interface ApprovalAnalytics {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  approvalRate: number;
}
