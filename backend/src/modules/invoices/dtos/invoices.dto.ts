import { IsString, IsNumber, IsOptional, IsDateString, IsEnum } from 'class-validator';

export class CreateInvoiceDto {
  @IsString()
  organizationId: string = '';

  @IsString()
  consumerUnitId: string = '';

  @IsString()
  energyContractId: string = '';

  @IsString()
  invoiceNumber: string = '';

  @IsDateString()
  issueDate: string = '';

  @IsDateString()
  dueDate: string = '';

  @IsDateString()
  referenceMonth: string = '';

  @IsEnum(['regulated', 'free_market', 'adjustment'])
  invoiceType: 'regulated' | 'free_market' | 'adjustment' = 'regulated';

  @IsNumber()
  consumptionKwh: number = 0;

  @IsOptional()
  @IsNumber()
  demandKw?: number;

  @IsNumber()
  energyTariff: number = 0;

  @IsOptional()
  @IsNumber()
  demandTariff?: number;

  @IsNumber()
  distributionCost: number = 0;

  @IsNumber()
  transmissionCost: number = 0;

  @IsNumber()
  pis: number = 0;

  @IsNumber()
  cofins: number = 0;

  @IsNumber()
  icms: number = 0;

  @IsNumber()
  tusd: number = 0;

  @IsNumber()
  te: number = 0;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  invoiceUrl?: string;
}

export class SimulateRegulatedMarketDto {
  @IsString()
  consumerUnitId: string = '';

  @IsDateString()
  referenceMonth: string = '';

  @IsNumber()
  consumptionKwh: number = 0;

  @IsOptional()
  @IsNumber()
  demandKw?: number;

  @IsNumber()
  peakRate: number = 0;

  @IsNumber()
  offPeakRate: number = 0;

  @IsOptional()
  @IsNumber()
  demandRate?: number;

  @IsNumber()
  pisPercentage: number = 0.0765;

  @IsNumber()
  cofinsPercentage: number = 0.076;

  @IsNumber()
  icmsPercentage: number = 0.18;

  @IsNumber()
  tusdPercentage: number = 0.15;

  @IsNumber()
  tePercentage: number = 0.12;
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsEnum(['draft', 'issued', 'paid', 'cancelled'])
  status?: 'draft' | 'issued' | 'paid' | 'cancelled';

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @IsOptional()
  @IsDateString()
  paidDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class GetInvoicesDto {
  @IsOptional()
  @IsString()
  consumerUnitId?: string;

  @IsOptional()
  @IsEnum(['draft', 'issued', 'paid', 'cancelled'])
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
