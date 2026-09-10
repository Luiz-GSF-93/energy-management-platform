export interface Invoice {
  id: string;
  organizationId: string;
  consumerUnitId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  referenceMonth: string;
  invoiceType: 'regulated' | 'free-market';
  consumptionKwh: number;
  energyTariff: number;
  distributionCost: number;
  transmissionCost: number;
  pis: number;
  cofins: number;
  icms: number;
  totalAmount: number;
  status: 'pending' | 'approved' | 'paid';
  createdAt: string;
  updatedAt: string;
}

export interface SimulationResult {
  success: boolean;
  energyCostCalculated: number;
  chargesTotal: number;
  totalEstimated: number;
}

export interface ManagementFee {
  id: string;
  organizationId: string;
  consumerUnitId: string;
  contractType: 'fixed' | 'percentage' | 'hybrid';
  monthlyFeeFixed?: number;
  percentageOfSavings?: number;
  status: 'active' | 'inactive';
}

export interface SavingsData {
  referenceMonth: string;
  originalCost: number;
  finalCost: number;
  grossSavings: number;
  netSavings: number;
  percentageSavings: number;
}

export interface DashboardMetrics {
  totalSavings: number;
  averageSavingsPerMonth: number;
  totalInvoices: number;
  pendingInvoices: number;
  currentMonthSavings: number;
  lastMonthSavings: number;
}

export interface ConsumerUnit {
  id: string;
  organizationId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  consumerNumber: string;
  distributionCompany: string;
  status: 'active' | 'inactive';
}

export interface EnergyContract {
  id: string;
  organizationId: string;
  consumerUnitId: string;
  contractType: 'regulated' | 'free-market';
  startDate: string;
  endDate?: string;
  status: 'active' | 'inactive' | 'expired';
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: 'admin' | 'manager' | 'viewer';
}
