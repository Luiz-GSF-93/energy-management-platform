import { IsString, IsNumber, IsDate, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSettlementDto {
  @IsString()
  energy_contract_id: string;

  @IsString()
  consumer_unit_id: string;

  @IsDate()
  @Type(() => Date)
  month: Date;

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
