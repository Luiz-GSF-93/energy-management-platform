import {Type} from 'class-transformer';
import {IsArray,ArrayMaxSize,ValidateNested,IsNumber,Min,IsDateString,Matches,IsIn,IsOptional,IsString,MaxLength} from 'class-validator';
export class AnnualPriceDto {
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
 @IsNumber() @Min(0) pricePerMwh!:number;
 @IsIn(['FINAL','BASE']) priceStatus!:string;
}
export class SupplyTermsDto {
 @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>AnnualPriceDto) annualPrices?:AnnualPriceDto[];
 @IsOptional() @IsIn(['FIXED','INDEXED','MIXED']) pricingMode?:string;
 @IsOptional() @IsString() @MaxLength(4096) adjustmentRule?:string;
 @IsOptional() @IsIn(['BANK_GUARANTEE','INSURANCE','BANK_DEPOSIT','OTHER']) guaranteeType?:string|null;
 @IsOptional() @IsNumber() @Min(0) guaranteeAmount?:number|null;
 @IsOptional() @IsString() @Matches(/\S/) @MaxLength(255) guaranteeInstitution?:string|null;
 @IsOptional() @IsString() @MaxLength(1000) guaranteeDescription?:string|null;
}
