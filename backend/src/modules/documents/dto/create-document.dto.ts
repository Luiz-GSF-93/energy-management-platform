import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateDocumentDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  fileName!: string;

  @IsString()
  fileType!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  documentType?: string;

  @IsOptional()
  @IsString()
  ocrData?: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  ocrData?: string;
}
