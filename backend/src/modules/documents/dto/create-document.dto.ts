import { IsString, IsOptional, IsUUID, IsIn, IsInt, Min, Max, MaxLength, Matches, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateDocumentDto {
  @IsUUID()
  customerId!: string;
  @IsUUID()
  consumerUnitId!: string;
  @IsString() @Matches(/\S/) @MaxLength(255)
  fileName!: string;
  @IsIn(['application/pdf', 'image/jpeg', 'image/png'])
  fileType!: string;
  @IsIn(['INVOICE_DISTRIBUTOR','INVOICE_SUPPLIER','CONTRACT_ENERGY','CONTRACT_MANAGEMENT','CCEE_SETTLEMENT','CCEE_CHARGES','TAX_DOCUMENT','COMPLIANCE_REPORT','OTHER'])
  documentType!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-01$/)
  referenceMonth!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @Matches(/^[a-f0-9]{64}$/)
  fileHash!: string;
  @IsInt() @Min(1) @Max(2147483647)
  fileSizeBytes!: number;
  @IsString() @MaxLength(500) @Matches(/^[A-Za-z0-9_./-]+$/)
  filePath!: string;
  @IsOptional() @IsUUID()
  energyContractId?: string;
  @IsOptional() @IsString() @MaxLength(4096)
  description?: string;
}

// OCR results and processing/validation states belong to trusted workflows.
export class UpdateDocumentDto {
  @IsOptional() @IsString() @MaxLength(4096)
  description?: string;
}
