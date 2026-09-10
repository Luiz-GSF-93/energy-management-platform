import { IsString, IsNumber, IsOptional, IsEnum, IsDateString } from 'class-validator';

export class CreateManagementContractDto {
  @IsString()
  organizationId: string = '';

  @IsString()
  consumerUnitId: string = '';

  @IsString()
  energyContractId: string = '';

  @IsEnum(['fixed', 'percentage', 'hybrid'])
  contractType: 'fixed' | 'percentage' | 'hybrid' = 'fixed';

  @IsOptional()
  @IsNumber()
  monthlyFeeFixed?: number;

  @IsOptional()
  @IsNumber()
  setupFee?: number;

  @IsOptional()
  @IsNumber()
  percentageOfSavings?: number;

  @IsOptional()
  @IsNumber()
  percentageOfGrossSavings?: number;

  @IsOptional()
  @IsNumber()
  baseFee?: number;

  @IsOptional()
  @IsNumber()
  incentivePercentage?: number;

  @IsOptional()
  @IsNumber()
  targetSavings?: number;

  @IsDateString()
  startDate: string = '';

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CalculateFeeDto {
  @IsString()
  managementContractId: string = '';

  @IsString()
  settlementId: string = '';

  @IsDateString()
  referenceMonth: string = '';

  @IsNumber()
  grossSavings: number = 0;

  @IsNumber()
  netSavings: number = 0;

  @IsNumber()
  originalCost: number = 0;

  @IsNumber()
  finalCost: number = 0;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CompareFeeDto {
  @IsString()
  settlementId: string = '';

  @IsDateString()
  referenceMonth: string = '';

  @IsNumber()
  grossSavings: number = 0;

  @IsNumber()
  fixedFeeOption?: number;

  @IsNumber()
  percentageOption?: number;

  @IsNumber()
  hybridFixedComponent?: number;

  @IsNumber()
  hybridVariableComponent?: number;
}

export class ApproveFeeDto {
  @IsString()
  feeCalculationId: string = '';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateHonoraryPayoutDto {
  @IsString()
  organizationId: string = '';

  @IsString()
  consumerUnitId: string = '';

  @IsDateString()
  referenceMonth: string = '';

  @IsDateString()
  dueDate: string = '';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class GetFeesDto {
  @IsOptional()
  @IsString()
  managementContractId?: string;

  @IsOptional()
  @IsString()
  settlementId?: string;

  @IsOptional()
  @IsEnum(['pending', 'approved', 'paid', 'rejected'])
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class UpdateManagementContractDto {
  @IsOptional()
  @IsEnum(['active', 'inactive', 'expired', 'terminated'])
  status?: string;

  @IsOptional()
  @IsNumber()
  monthlyFeeFixed?: number;

  @IsOptional()
  @IsNumber()
  percentageOfSavings?: number;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
