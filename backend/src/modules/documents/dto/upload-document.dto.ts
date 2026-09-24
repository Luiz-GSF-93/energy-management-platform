import { IsUUID, IsIn, IsDateString, Matches, IsOptional, IsString, MaxLength } from 'class-validator';
export class UploadDocumentDto {
  @IsUUID() customerId!: string;
  @IsUUID() consumerUnitId!: string;
  @IsIn(['INVOICE_DISTRIBUTOR','INVOICE_SUPPLIER','CONTRACT_ENERGY','CONTRACT_MANAGEMENT','CCEE_SETTLEMENT','CCEE_CHARGES','TAX_DOCUMENT','COMPLIANCE_REPORT','OTHER']) documentType!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-01$/) referenceMonth!: string;
  @IsOptional() @IsUUID() energyContractId?: string;
  @IsOptional() @IsString() @MaxLength(4096) description?: string;
}
