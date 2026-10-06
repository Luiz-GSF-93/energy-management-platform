import { IsString, IsEmail, IsOptional, IsUUID, IsArray } from 'class-validator';

export class CreateCustomerDto {
  @IsOptional()
  @IsArray()
  report_contacts?: unknown[];

  @IsString()
  company_name!: string;

  @IsOptional()
  @IsString()
  trade_name?: string;

  @IsString()
  document!: string;

  @IsOptional()
  @IsString()
  economic_group?: string;

  @IsOptional()
  @IsString()
  contact_name?: string;

  @IsOptional()
  @IsEmail()
  contact_email?: string;

  @IsOptional()
  @IsString()
  contact_phone?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  company_name?: string;

  @IsOptional()
  @IsString()
  trade_name?: string;

  @IsOptional()
  @IsEmail()
  contact_email?: string;

  @IsOptional()
  @IsString()
  contact_phone?: string;
}
