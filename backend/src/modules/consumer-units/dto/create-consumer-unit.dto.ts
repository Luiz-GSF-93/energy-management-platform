import { IsString, IsOptional, IsUUID, IsNumber, MaxLength, Matches, Min, IsIn, ValidateIf } from 'class-validator';

export class CreateConsumerUnitDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  name!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(20)
  code!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(50)
  distributor!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(10)
  tariffGroup!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['BLUE', 'GREEN', 'WHITE', 'CONVENTIONAL'])
  tariffModality?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  contractedDemand?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  state?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  installedCapacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  voltageClass?: string;
}

export class UpdateConsumerUnitDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  installedCapacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  voltageClass?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(20)
  code?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(50)
  distributor?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(10)
  tariffGroup?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['BLUE', 'GREEN', 'WHITE', 'CONVENTIONAL'])
  tariffModality?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  contractedDemand?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['ACTIVE', 'INACTIVE', 'MIGRATED', 'CHURN', 'SEASONAL'])
  status?: string;
}
