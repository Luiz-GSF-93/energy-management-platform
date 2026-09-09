import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class TariffDto {
  @IsString()
  energy_contract_id: string = '';

  @IsString()
  month: string = '';

  @IsNumber()
  @Min(0)
  regulated_tariff: number = 0;

  @IsNumber()
  @Min(0)
  acl_tariff: number = 0;

  @IsNumber()
  @IsOptional()
  @Min(0)
  pld_price?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  te_price?: number;
}
