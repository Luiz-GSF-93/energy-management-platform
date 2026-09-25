import {IsString,IsUUID,IsIn,IsNumber,Min,Max,MaxLength,Matches,IsOptional,IsDateString} from 'class-validator';
class PeriodDto {
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
}
export class ManagementDto extends PeriodDto {
 @IsUUID() customerId!:string;
 @IsString() @Matches(/\S/) @MaxLength(50) contractNumber!:string;
 @IsIn(['FIXED','HYBRID']) remunerationModel!:string;
 @IsNumber() @Min(0) fixedFeeMonthly!:number;
 @IsNumber() @Min(0) @Max(100) savingsPercentage!:number;
 @IsString() @Matches(/\S/) @MaxLength(4096) applicationRules!:string;
}
export class PricePeriodDto extends PeriodDto {
 @IsNumber() @Min(0) pricePerMwh!:number;
 @IsString() @Matches(/\S/) @MaxLength(4096) reason!:string;
}
export class ServiceAgreementDto extends PeriodDto {
 @IsUUID() customerId!:string;
 @IsOptional() @IsUUID() consumerUnitId?:string;
 @IsIn(['INTERMEDIATION','OTHER']) agreementType!:string;
 @IsString() @Matches(/\S/) @MaxLength(100) contractNumber!:string;
 @IsString() @Matches(/\S/) @MaxLength(255) counterparty!:string;
 @IsString() @Matches(/\S/) @MaxLength(2000) description!:string;
 @IsIn(['FIXED_MONTHLY','PER_MWH','PERCENTAGE','CUSTOM']) billingBasis!:string;
 @IsOptional() @IsNumber() @Min(0) agreedValue?:number;
 @IsString() @Matches(/\S/) @MaxLength(4096) applicationRules!:string;
}
