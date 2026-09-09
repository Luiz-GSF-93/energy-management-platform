import { IsString, IsOptional, IsUUID, IsDate, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateContractDto {
  @IsUUID()
  consumerUnitId!: string;

  @IsString()
  contractNumber!: string;

  @IsDate()
  @Type(() => Date)
  startDate!: Date;

  @IsDate()
  @Type(() => Date)
  endDate!: Date;

  @IsOptional()
  @IsNumber()
  minimumSavings?: number;

  @IsOptional()
  @IsNumber()
  honorariePercentage?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateContractDto {
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endDate?: Date;

  @IsOptional()
  @IsNumber()
  minimumSavings?: number;

  @IsOptional()
  @IsString()
  status?: string;
}
