import { IsString, IsNumber, IsDate, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ConsumptionHistoryDto {
  @IsString()
  consumer_unit_id: string;

  @IsDate()
  @Type(() => Date)
  month: Date;

  @IsNumber()
  @Min(0)
  consumption_kwh: number;

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
