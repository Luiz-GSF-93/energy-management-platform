import { IsString, IsNumber, IsDate, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TariffDto {
  @IsString()
  energy_contract_id: string;

  @IsDate()
  @Type(() => Date)
  month: Date;

  @IsNumber()
  @Min(0)
  regulated_tariff: number;

  @IsNumber()
  @Min(0)
  acl_tariff: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  pld_price?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  te_price?: number;
}
