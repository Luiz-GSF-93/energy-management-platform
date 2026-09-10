import { IsString, IsOptional, IsDateString, IsUUID } from 'class-validator';

export class GetAuditLogsDto {
  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;
}

export class ApproveSettlementDto {
  @IsString()
  settlementId: string = '';

  @IsString()
  approvalType: 'validation' | 'adjustment' | 'publication' = 'validation';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class GetSettlementHistoryDto {
  @IsUUID()
  settlementId: string = '';
}
