import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class CreateLicenseDto {
  @IsString()
  @IsNotEmpty()
  licenseType!: string;

  @IsInt()
  @Min(0)
  documentsLimit!: number;

  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  renewalDate!: string;

  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

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
}
