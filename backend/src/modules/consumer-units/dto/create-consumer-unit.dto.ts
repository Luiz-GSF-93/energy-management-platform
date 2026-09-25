import { IsString, IsOptional, IsUUID, IsNumber, MaxLength, Matches, Min, IsIn, ValidateIf, IsBoolean, IsDateString } from 'class-validator';

class ElectricalFieldsDto {
 @IsOptional() @IsIn(['A1','A2','A3','A3a','A4','AS','B1','B2','B3','B4']) tariffSubgroup?: string | null;
 @IsOptional() @IsIn(['INDUSTRIAL','COMMERCIAL','RURAL','PUBLIC_AUTHORITY','PUBLIC_SERVICE','RESIDENTIAL']) consumptionClass?: string | null;
 @IsOptional() @IsBoolean() freeMarket?: boolean | null;
 @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) lastDemandAdjustmentDate?: string | null;
 @IsOptional() @IsNumber() @Min(0) contractedDemandPeak?: number | null;
 @IsOptional() @IsNumber() @Min(0) contractedDemandOffPeak?: number | null;
 @IsOptional() @IsNumber() @Min(0) demandTariff?: number | null;
 @IsOptional() @IsNumber() @Min(0) demandTariffPeak?: number | null;
 @IsOptional() @IsNumber() @Min(0) demandTariffOffPeak?: number | null;
 @IsOptional() @IsNumber() @Min(0) energyTariffPeak?: number | null;
 @IsOptional() @IsNumber() @Min(0) energyTariffOffPeak?: number | null;
 @IsOptional() @IsNumber() @Min(0) reactiveEnergyTariff?: number | null;
 @IsOptional() @IsNumber() @Min(0) lastDemandValue?: number | null;
 @IsOptional() @IsNumber() @Min(0) lastDemandPeak?: number | null;
 @IsOptional() @IsNumber() @Min(0) lastDemandOffPeak?: number | null;
}

export class CreateConsumerUnitDto extends ElectricalFieldsDto {
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

export class UpdateConsumerUnitDto extends ElectricalFieldsDto {
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
