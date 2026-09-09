import { IsUUID, IsDate, IsNumber, IsOptional, IsString, Type } from 'class-validator';

export class CreateSettlementDto {
  @IsUUID()
  contractId!: string;

  @IsUUID()
  consumerUnitId!: string;

  @IsDate()
  @Type(() => Date)
  month!: Date;

  @IsNumber()
  consumptionKwh!: number;

  @IsNumber()
  regulatedCost!: number;

  @IsNumber()
  aclCost!: number;

  @IsOptional()
  @IsNumber()
  deductions?: number;
}

export class UpdateSettlementDto {
  @IsOptional()
  @IsString()
  status?: 'DRAFT' | 'PROCESSING' | 'APPROVED' | 'PUBLISHED';

  @IsOptional()
  @IsNumber()
  netSavings?: number;

  @IsOptional()
  @IsNumber()
  honorarie?: number;
}

export class ApproveSettlementDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class PublishSettlementDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
