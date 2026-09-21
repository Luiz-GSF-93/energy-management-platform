import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export const LICENSE_STATUSES = [
  'active',
  'suspended',
  'expired',
  'cancelled',
] as const;

export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export class UpdateLicenseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  licenseType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  documentsLimit?: number;

  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  renewalDate?: string;

  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxConsumerUnits?: number;

  @IsOptional()
  @IsBoolean()
  documentManagement?: boolean;

  @IsOptional()
  @IsBoolean()
  advancedAnalytics?: boolean;

  @IsOptional()
  @IsBoolean()
  reportGeneration?: boolean;

  @IsOptional()
  @IsBoolean()
  freeMarketManagement?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(LICENSE_STATUSES)
  status?: LicenseStatus;
}
