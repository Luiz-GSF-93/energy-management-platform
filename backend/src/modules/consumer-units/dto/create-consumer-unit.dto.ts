import { IsString, IsOptional, IsUUID, IsNumber } from 'class-validator';

export class CreateConsumerUnitDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsNumber()
  installedCapacity?: number;

  @IsOptional()
  @IsString()
  voltageClass?: string;
}

export class UpdateConsumerUnitDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  installedCapacity?: number;
}
