import { IsString, IsEmail, IsOptional, IsUUID } from 'class-validator';

export class CreateCustomerDto {
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
