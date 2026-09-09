import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class ConsumptionHistoryDto {
  @IsString()
  consumer_unit_id: string = '';

  @IsString()
  month: string = '';

  @IsNumber()
  @Min(0)
  consumption_kwh: number = 0;

  @IsNumber()
  @IsOptional()
  average_rate?: number;

  @IsNumber()
  @IsOptional()
  peak_consumption?: number;

  @IsNumber()
  @IsOptional()
  off_peak_consumption?: number;
}
