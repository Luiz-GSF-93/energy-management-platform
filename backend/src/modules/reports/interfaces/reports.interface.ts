export interface FinancialSummary {
  organizationId: string;
  period: string;
  totalSettlements: number;
  totalValidated: number;
  totalApproved: number;
  totalAnomalies: number;
  financialMetrics: {
    totalGrossSavings: number;
    totalDeductions: number;
    totalNetSavings: number;
    totalHonorary: number;
    averageSavingsPerSettlement: number;
  };
  statusDistribution: {
    draft: number;
    validated: number;
    approved: number;
    published: number;
  };
}

export interface SettlementReport {
  period: string;
  settlements: SettlementReportItem[];
  summary: FinancialSummary;
}

export interface SettlementReportItem {
  settlementId: string;
  month: Date;
  status: string;
  validationStatus: string;
  consumptionKwh: number;
  regulatedCost: number;
  aclCost: number;
  grossSavings: number;
  deductions: number;
  netSavings: number;
  honorarie: number;
  finalValue: number;
  approvedAt?: Date;
  publishedAt?: Date;
}

export interface AnomalyReport {
  totalAnomalies: number;
  criticalAnomalies: number;
  warningAnomalies: number;
  anomalies: AnomalyItem[];
}

export interface AnomalyItem {
  settlementId: string;
  month: Date;
  anomalyType: string;
  severity: 'critical' | 'warning' | 'info';
  description: string;
  value: number;
  expectedRange: { min: number; max: number };
  detectedAt: Date;
}

export interface ApprovalMetrics {
  totalSettlements: number;
  approvedSettlements: number;
  pendingSettlements: number;
  rejectedSettlements: number;
  approvalRate: number;
  averageTimeToApproval: number;
  topApprovers: { userId: string; count: number; userName?: string }[];
}

export interface SavingsComparison {
  period: string;
  settlements: SavingsItem[];
  aggregated: {
    totalGrossSavings: number;
    totalDeductions: number;
    totalNetSavings: number;
    deductionPercentage: number;
  };
}

export interface SavingsItem {
  settlementId: string;
  month: Date;
  grossSavings: number;
  deductions: number;
  netSavings: number;
  deductionPercentage: number;
}

export interface ReportExportRequest {
  reportType: 'summary' | 'settlements' | 'anomalies' | 'approvals' | 'savings';
  format: 'pdf' | 'excel' | 'csv';
  period?: string;
  filters?: Record<string, any>;
}
