import { IsUUID, IsDate, IsNumber, IsOptional, Type } from 'class-validator';

export class CreateTariffDto {
  @IsUUID()
  contractId!: string;

  @IsDate()
  @Type(() => Date)
  month!: Date;

  @IsNumber()
  regulatedTariff!: number;

  @IsNumber()
  aclTariff!: number;

  @IsOptional()
  @IsNumber()
  pldPrice?: number;

  @IsOptional()
  @IsNumber()
  tePrice?: number;
}
