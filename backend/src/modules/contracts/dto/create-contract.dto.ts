import { IsString, IsOptional, IsUUID, IsDateString, IsNumber, IsIn, Min, MaxLength, Matches, ValidateIf } from 'class-validator';

export class CreateContractDto {
  @IsUUID()
  consumerUnitId!: string;
  @IsString() @Matches(/\S/) @MaxLength(50)
  contractNumber!: string;
  @IsIn(['ENERGY_PURCHASE', 'ENERGY_SALE', 'MANAGEMENT', 'INTERMEDIATION', 'OTHER'])
  contractType!: string;
  @IsNumber() @Min(0)
  contractedVolumeMwh!: number;
  @IsNumber() @Min(0)
  currentPrice!: number;
  @IsDateString({ strict: true })
  startDate!: string;
  @IsDateString({ strict: true })
  endDate!: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['DRAFT', 'ACTIVE'])
  status?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['ENERGY', 'ENERGY_POWER', 'POWER'])
  energyType?: string;
  @IsOptional() @IsString() @MaxLength(255) @Matches(/\S/)
  supplierId?: string;
  @IsOptional() @IsString() @MaxLength(50)
  energySource?: string;
  @IsOptional() @IsString() @MaxLength(50)
  adjustmentIndex?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['ANNUAL', 'SEMIANNUAL', 'QUARTERLY', 'MONTHLY', 'CUSTOM'])
  adjustmentFrequency?: string;
  @IsOptional() @IsDateString({ strict: true })
  adjustmentDate?: string;
  @IsOptional() @IsUUID()
  managementContractId?: string;
  @IsOptional() @IsString() @MaxLength(4096)
  notes?: string;
}

// Parent, number and start date are immutable; only drafts may be changed.
export class UpdateContractDto {
  @ValidateIf((_o, v) => v !== undefined) @IsDateString({ strict: true })
  endDate?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsNumber() @Min(0)
  contractedVolumeMwh?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsNumber() @Min(0)
  currentPrice?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['DRAFT', 'ACTIVE'])
  status?: string;
  @IsOptional() @IsString() @MaxLength(4096)
  notes?: string;
}
