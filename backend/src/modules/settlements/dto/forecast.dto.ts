import { IsString, IsNumber, IsDate, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ForecastDto {
  @IsString()
  consumer_unit_id: string;

  @IsDate()
  @Type(() => Date)
  forecast_month: Date;

  @IsNumber()
  @Min(0)
  base_scenario: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  optimistic_scenario?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  pessimistic_scenario?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  confidence_level?: number;
}
