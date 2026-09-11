import { IsString, IsNumber, IsEnum, IsOptional, Min, Max } from 'class-validator';

export class CalculateSettlementDto {
  @IsString()
  consumerUnitId: string;

  @IsString()
  referenceMonth: string; // YYYY-MM-DD

  @IsNumber()
  @Min(0)
  consumptionMwh: number;

  @IsNumber()
  @Min(0)
  regulatedEnergyPrice: number;

  @IsNumber()
  @Min(0)
  regulatedTusdCost: number;

  @IsNumber()
  @Min(0)
  regulatedTaxes: number;

  @IsNumber()
  @Min(0)
  contractedPrice: number;

  @IsNumber()
  @Min(0)
  cceeCost: number;

  @IsNumber()
  @Min(0)
  chargesCost: number;

  @IsNumber()
  @Min(0)
  taxesCost: number;

  @IsEnum(['FIXED', 'HYBRID', 'PERFORMANCE'])
  remunerationModel: 'FIXED' | 'HYBRID' | 'PERFORMANCE';

  @IsNumber()
  @IsOptional()
  @Min(0)
  fixedFee?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  variablePercentage?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  minConsumption?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxConsumption?: number;
}
