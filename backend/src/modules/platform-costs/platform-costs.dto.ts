import {IsBoolean,IsEmail,IsIn,IsInt,IsNumber,IsOptional,IsString,Matches,Max,MaxLength,Min,MinLength} from 'class-validator';
export class CostPolicyDto {
 @IsOptional() @IsInt() @Min(1) @Max(1000000000000) monthly_cost_limit_brl_cents?:number;
 @IsInt() @Min(1) revision!:number;
 @IsInt() @Min(0) @Max(1000000000000) platform_ai_micro_usd!:number;
 @IsOptional() @IsEmail() @MaxLength(254) email?:string;
 @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) whatsapp?:string;
 @IsBoolean() email_enabled!:boolean;
 @IsOptional() @IsNumber() @Min(.000001) @Max(10000) usd_brl_rate?:number;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) fx_date?:string;
}
export class InfrastructureCostDto {
 @Matches(/^\d{4}-(0[1-9]|1[0-2])-01$/) month!:string;
 @IsString() @MinLength(1) @MaxLength(80) provider!:string;
 @IsString() @MinLength(1) @MaxLength(120) service!:string;
 @IsIn(['SERVER','DATABASE','STORAGE','BACKUP','OCR','OTHER']) category!:string;
 @IsOptional() @IsString() @MinLength(1) @MaxLength(200) organization_id?:string;
 @IsInt() @Min(0) @Max(1000000000000) amount_minor!:number;
 @IsIn(['USD','BRL']) currency!:string;
 @IsIn(['INVOICE','ESTIMATE']) basis!:string;
 @IsString() @MinLength(3) @MaxLength(1000) source!:string;
}
