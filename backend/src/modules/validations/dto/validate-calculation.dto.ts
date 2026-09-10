import { IsString, IsNumber, IsUUID, IsOptional } from 'class-validator';

export class ValidateCalculationDto {
  @IsUUID()
  settlementId: string;

  @IsString()
  energyContractId: string;

  @IsString()
  organizationId: string;

  @IsNumber()
  consumptionKwh: number;

  @IsNumber()
  regulatedCost: number;

  @IsNumber()
  aclCost: number;

  @IsNumber()
  grossSavings: number;

  @IsNumber()
  netSavings: number;

  @IsNumber()
  honorarie: number;

  @IsNumber()
  totalCost: number;

  @IsNumber()
  finalValue: number;

  @IsOptional()
  @IsString()
  validatedBy?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
