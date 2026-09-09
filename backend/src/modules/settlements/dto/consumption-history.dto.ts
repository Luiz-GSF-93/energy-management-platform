import { IsUUID, IsDate, IsNumber, IsOptional, Type } from 'class-validator';

export class CreateConsumptionHistoryDto {
  @IsUUID()
  consumerUnitId!: string;

  @IsDate()
  @Type(() => Date)
  month!: Date;

  @IsNumber()
  consumptionKwh!: number;

  @IsOptional()
  @IsNumber()
  averageRate?: number;

  @IsOptional()
  @IsNumber()
  peakConsumption?: number;

  @IsOptional()
  @IsNumber()
  offPeakConsumption?: number;
}
