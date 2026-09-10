import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';

export class GetSummaryReportDto {
  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class GetSettlementReportDto {
  @IsString()
  period: string = 'month';

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  validationStatus?: string;
}

export class GetAnomalyReportDto {
  @IsOptional()
  @IsString()
  severity?: 'critical' | 'warning' | 'info';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  anomalyType?: string;
}

export class GetApprovalMetricsDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class GetSavingsComparisonDto {
  @IsString()
  period: string = 'month';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class ExportReportDto {
  @IsEnum(['summary', 'settlements', 'anomalies', 'approvals', 'savings'])
  reportType: 'summary' | 'settlements' | 'anomalies' | 'approvals' | 'savings' = 'summary';

  @IsEnum(['pdf', 'excel', 'csv'])
  format: 'pdf' | 'excel' | 'csv' = 'pdf';

  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
