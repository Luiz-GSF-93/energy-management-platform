import {Type} from 'class-transformer';
import {IsArray,IsInt,Max,ArrayMinSize,ValidateIf,ArrayMaxSize,ValidateNested,IsNumber,Min,IsDateString,Matches,IsIn,IsOptional,IsString,MaxLength} from 'class-validator';
export class AnnualPriceDto {
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
 @IsNumber() @Min(0) pricePerMwh!:number;
 @IsIn(['FINAL','BASE']) priceStatus!:string;
}
export class SeasonalityYearDto {
 @IsInt() @Min(1900) @Max(9999) year!:number;
 @IsNumber() @Min(0) annualVolumeMwh!:number;
 @IsArray() @ArrayMinSize(12) @ArrayMaxSize(12) @IsNumber({maxDecimalPlaces:4},{each:true}) @Min(0,{each:true}) @Max(100,{each:true}) monthlyPercentages!:number[];
}

export class SupplyTermsDto {
 @IsOptional() @IsNumber({maxDecimalPlaces:4}) @Min(0) flexibilityMinPercent?:number|null;
 @IsOptional() @IsNumber({maxDecimalPlaces:4}) @Min(0) flexibilityMaxPercent?:number|null;
 @IsOptional() @IsIn(['FLEX','LOAD_FOLLOWING']) modulation?:string|null;
 @IsOptional() @IsIn(['S','SE_CO','NE','N']) submarket?:string|null;
 @IsOptional() @IsIn(['RULE','MONTHLY','BOTH']) seasonalityMode?:string|null;
 @IsOptional() @IsString() @MaxLength(4096) seasonalityRule?:string|null;
 @ValidateIf((_o,v)=>v!==undefined) @IsArray() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>SeasonalityYearDto) seasonalVolumes?:SeasonalityYearDto[];

 @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>AnnualPriceDto) annualPrices?:AnnualPriceDto[];
 @IsOptional() @IsIn(['FIXED','INDEXED','MIXED']) pricingMode?:string;
 @IsOptional() @IsString() @MaxLength(4096) adjustmentRule?:string;
 @IsOptional() @IsIn(['BANK_GUARANTEE','INSURANCE','BANK_DEPOSIT','OTHER']) guaranteeType?:string|null;
 @IsOptional() @IsNumber() @Min(0) guaranteeAmount?:number|null;
 @IsOptional() @IsString() @Matches(/\S/) @MaxLength(255) guaranteeInstitution?:string|null;
 @IsOptional() @IsString() @MaxLength(1000) guaranteeDescription?:string|null;
}
