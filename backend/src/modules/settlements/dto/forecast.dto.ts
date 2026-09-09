import { IsUUID, IsDate, IsNumber, IsOptional, Type } from 'class-validator';

export class CreateForecastDto {
  @IsUUID()
  consumerUnitId!: string;

  @IsDate()
  @Type(() => Date)
  forecastMonth!: Date;

  @IsNumber()
  baseScenario!: number;

  @IsOptional()
  @IsNumber()
  optimisticScenario?: number;

  @IsOptional()
  @IsNumber()
  pessimisticScenario?: number;

  @IsOptional()
  @IsNumber()
  confidenceLevel?: number;
}
