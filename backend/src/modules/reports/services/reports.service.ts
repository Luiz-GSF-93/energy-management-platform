import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import {
  FinancialSummary,
  SettlementReport,
  AnomalyReport,
  ApprovalMetrics,
  SavingsComparison,
} from '../interfaces/reports.interface';
import {
  GetSummaryReportDto,
  GetSettlementReportDto,
  GetAnomalyReportDto,
  GetApprovalMetricsDto,
  GetSavingsComparisonDto,
} from '../dtos/reports.dto';

@Injectable()
export class ReportsService {
  constructor(private supabaseService: SupabaseService) {}

  async getSummaryReport(
    organizationId: string,
    filters: GetSummaryReportDto
  ): Promise<FinancialSummary> {
    try {
      const client = this.supabaseService.getClient();
      const { startDate, endDate } = this.getPeriodDates(filters.period);

      let query = client
        .from('monthly_energy_settlements')
        .select(
          'id, status, validation_status, consumption_kwh, regulated_cost, acl_cost, gross_savings, deductions, net_savings, honorarie, created_at, approved_at, published_at'
        )
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      const { data: settlements, error: settlementError } = await query;

      if (settlementError) {
        throw settlementError;
      }

      const settlementList = (settlements || []) as any[];

      const totalSettlements = settlementList.length;
      const totalValidated = settlementList.filter(
        (s: any) => s.validation_status === 'valid'
      ).length;
      const totalApproved = settlementList.filter(
        (s: any) => s.approved_at !== null
      ).length;

      const { data: anomalies } = await client
        .from('calculation_anomalies')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      const totalAnomalies = (anomalies || []).length;

      const financialMetrics = {
        totalGrossSavings: settlementList.reduce(
          (sum: number, s: any) => sum + (s.gross_savings || 0),
          0
        ),
        totalDeductions: settlementList.reduce(
          (sum: number, s: any) => sum + (s.deductions || 0),
          0
        ),
        totalNetSavings: settlementList.reduce(
          (sum: number, s: any) => sum + (s.net_savings || 0),
          0
        ),
        totalHonorary: settlementList.reduce(
          (sum: number, s: any) => sum + (s.honorarie || 0),
          0
        ),
        averageSavingsPerSettlement:
          totalSettlements > 0
            ? settlementList.reduce(
                (sum: number, s: any) => sum + (s.net_savings || 0),
                0
              ) / totalSettlements
            : 0,
      };

      const statusDistribution = {
        draft: settlementList.filter((s: any) => s.status === 'DRAFT').length,
        validated: settlementList.filter(
          (s: any) => s.validation_status === 'valid'
        ).length,
        approved: totalApproved,
        published: settlementList.filter(
          (s: any) => s.published_at !== null
        ).length,
      };

      return {
        organizationId,
        period: filters.period || 'custom',
        totalSettlements,
        totalValidated,
        totalApproved,
        totalAnomalies,
        financialMetrics,
        statusDistribution,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar resumo:', exception);
      throw exception;
    }
  }

  async getSettlementReport(
    organizationId: string,
    filters: GetSettlementReportDto
  ): Promise<SettlementReport> {
    try {
      const client = this.supabaseService.getClient();
      const { startDate, endDate } = this.getPeriodDates(filters.period);

      let query = client
        .from('monthly_energy_settlements')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.validationStatus) {
        query = query.eq('validation_status', filters.validationStatus);
      }

      const { data: settlements, error } = await query.order('month', {
        ascending: false,
      });

      if (error) {
        throw error;
      }

      const settlementItems = ((settlements || []) as any[]).map((s: any) => ({
        settlementId: s.id,
        month: new Date(s.month),
        status: s.status,
        validationStatus: s.validation_status,
        consumptionKwh: s.consumption_kwh,
        regulatedCost: s.regulated_cost,
        aclCost: s.acl_cost,
        grossSavings: s.gross_savings,
        deductions: s.deductions,
        netSavings: s.net_savings,
        honorarie: s.honorarie,
        finalValue: (s.net_savings || 0) - (s.honorarie || 0),
        approvedAt: s.approved_at ? new Date(s.approved_at) : undefined,
        publishedAt: s.published_at ? new Date(s.published_at) : undefined,
      }));

      const summary = await this.getSummaryReport(organizationId, {
        period: filters.period,
      });

      return {
        period: filters.period,
        settlements: settlementItems,
        summary,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar relatório:', exception);
      throw exception;
    }
  }

  async getAnomalyReport(
    organizationId: string,
    filters: GetAnomalyReportDto
  ): Promise<AnomalyReport> {
    try {
      const client = this.supabaseService.getClient();

      let query = client
        .from('calculation_anomalies')
        .select('*')
        .eq('organization_id', organizationId);

      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate);
      }

      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate);
      }

      if (filters.anomalyType) {
        query = query.eq('anomaly_type', filters.anomalyType);
      }

      const { data: anomalies, error } = await query.order('created_at', {
        ascending: false,
      });

      if (error) {
        throw error;
      }

      const anomalyList = ((anomalies || []) as any[]).map((a: any) => ({
        settlementId: a.settlement_id,
        month: new Date(a.month),
        anomalyType: a.anomaly_type,
        severity: a.severity || 'info',
        description: a.description,
        value: a.value,
        expectedRange: a.expected_range || { min: 0, max: 0 },
        detectedAt: new Date(a.created_at),
      }));

      const criticalAnomalies = anomalyList.filter(
        (a: any) => a.severity === 'critical'
      ).length;
      const warningAnomalies = anomalyList.filter(
        (a: any) => a.severity === 'warning'
      ).length;

      return {
        totalAnomalies: anomalyList.length,
        criticalAnomalies,
        warningAnomalies,
        anomalies: anomalyList,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar relatório de anomalias:', exception);
      throw exception;
    }
  }

  async getApprovalMetrics(
    organizationId: string,
    filters: GetApprovalMetricsDto
  ): Promise<ApprovalMetrics> {
    try {
      const client = this.supabaseService.getClient();

      const startDate = filters.startDate
        ? new Date(filters.startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = filters.endDate
        ? new Date(filters.endDate)
        : new Date();

      const { data: allSettlements } = await client
        .from('monthly_energy_settlements')
        .select('id, approved_by, approved_at, created_at')
        .eq('organization_id', organizationId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      const settlements = (allSettlements || []) as any[];
      const totalSettlements = settlements.length;
      const approvedSettlements = settlements.filter(
        (s: any) => s.approved_at !== null
      ).length;
      const pendingSettlements = totalSettlements - approvedSettlements;

      const approvalsWithTime = settlements
        .filter((s: any) => s.approved_at !== null)
        .map((s: any) => ({
          time:
            new Date(s.approved_at).getTime() -
            new Date(s.created_at).getTime(),
        }));

      const averageTimeToApproval =
        approvalsWithTime.length > 0
          ? approvalsWithTime.reduce((sum: number, a: any) => sum + a.time, 0) /
            approvalsWithTime.length /
            (1000 * 60 * 60)
          : 0;

      const approverMap = new Map();
      settlements
        .filter((s: any) => s.approved_by)
        .forEach((s: any) => {
          approverMap.set(
            s.approved_by,
            (approverMap.get(s.approved_by) || 0) + 1
          );
        });

      const topApprovers = Array.from(approverMap.entries())
        .map(([userId, count]: [string, any]) => ({ userId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        totalSettlements,
        approvedSettlements,
        pendingSettlements,
        rejectedSettlements: 0,
        approvalRate:
          totalSettlements > 0 ? (approvedSettlements / totalSettlements) * 100 : 0,
        averageTimeToApproval: Math.round(averageTimeToApproval),
        topApprovers,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar métricas de aprovação:', exception);
      throw exception;
    }
  }

  async getSavingsComparison(
    organizationId: string,
    filters: GetSavingsComparisonDto
  ): Promise<SavingsComparison> {
    try {
      const client = this.supabaseService.getClient();
      const { startDate, endDate } = this.getPeriodDates(filters.period);

      const { data: settlements, error } = await client
        .from('monthly_energy_settlements')
        .select(
          'id, month, gross_savings, deductions, net_savings, organization_id'
        )
        .eq('organization_id', organizationId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('month', { ascending: true });

      if (error) {
        throw error;
      }

      const savingsItems = ((settlements || []) as any[]).map((s: any) => ({
        settlementId: s.id,
        month: new Date(s.month),
        grossSavings: s.gross_savings || 0,
        deductions: s.deductions || 0,
        netSavings: s.net_savings || 0,
        deductionPercentage:
          s.gross_savings && s.gross_savings > 0
            ? ((s.deductions || 0) / s.gross_savings) * 100
            : 0,
      }));

      const aggregated = {
        totalGrossSavings: savingsItems.reduce(
          (sum: number, s: any) => sum + s.grossSavings,
          0
        ),
        totalDeductions: savingsItems.reduce(
          (sum: number, s: any) => sum + s.deductions,
          0
        ),
        totalNetSavings: savingsItems.reduce(
          (sum: number, s: any) => sum + s.netSavings,
          0
        ),
        deductionPercentage: 0,
      };

      aggregated.deductionPercentage =
        aggregated.totalGrossSavings > 0
          ? (aggregated.totalDeductions / aggregated.totalGrossSavings) * 100
          : 0;

      return {
        period: filters.period,
        settlements: savingsItems,
        aggregated,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar comparativo de economias:', exception);
      throw exception;
    }
  }

  private getPeriodDates(
    period?: string
  ): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1);
    }

    return { startDate, endDate };
  }
}
