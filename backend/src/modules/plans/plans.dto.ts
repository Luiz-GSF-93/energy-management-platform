import {IsBoolean,IsIn,ValidateNested,IsDateString,IsInt,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength} from 'class-validator';
import {Type} from 'class-transformer';
export class SavePlanDto {
 @IsString() @MinLength(2) @MaxLength(120) name!:string;
 @IsString() @MaxLength(2000) description!:string;
 @IsBoolean() active!:boolean;
 @IsOptional() @IsBoolean() documents_unlimited?:boolean;
 @IsInt() @Min(0) @Max(2147483647) documents_limit!:number;
 @IsInt() @Min(0) @Max(2147483647) max_consumer_units!:number;
 @IsInt() @Min(0) @Max(2147483647) max_users!:number;
 @IsBoolean() document_management!:boolean;
 @IsBoolean() advanced_analytics!:boolean;
 @IsBoolean() report_generation!:boolean;
 @IsBoolean() free_market_management!:boolean;
 @IsOptional() @IsInt() @Min(1) version?:number;
}
export class LicenseModulesDto {
 @IsBoolean() document_management!:boolean;
 @IsBoolean() advanced_analytics!:boolean;
 @IsBoolean() report_generation!:boolean;
 @IsBoolean() free_market_management!:boolean;
}
export class ApplyPlanDto {
 @IsOptional() @IsString() @MinLength(1) @MaxLength(200) licenseId?:string;
 @IsOptional() @IsInt() @Min(1) revision?:number;
 @IsOptional() @IsIn(['ACTIVE','SUSPENDED','EXPIRED','CANCELLED']) status?:string;
 @IsOptional() @ValidateNested() @Type(()=>LicenseModulesDto) modules?:LicenseModulesDto;
 @IsUUID() planId!:string;
 @IsInt() @Min(1) version!:number;
 @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?:string;
 @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) renewalDate!:string;
}

export class UpgradeRequestDto { @IsString() @MinLength(3) @MaxLength(2000) note!:string; }
