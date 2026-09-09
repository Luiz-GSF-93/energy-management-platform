import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class ForecastDto {
  @IsString()
  consumer_unit_id: string = '';

  @IsString()
  forecast_month: string = '';

  @IsNumber()
  @Min(0)
  base_scenario: number = 0;

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
