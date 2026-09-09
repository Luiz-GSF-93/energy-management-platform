import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateSettlementDto {
  @IsString()
  energy_contract_id: string = '';

  @IsString()
  consumer_unit_id: string = '';

  @IsString()
  month: string = '';

  @IsNumber()
  @IsOptional()
  consumption_kwh?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  gross_savings?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  deductions?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  honorarie?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
