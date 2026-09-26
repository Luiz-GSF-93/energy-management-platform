import {IsUUID,Matches,IsIn,IsString,MaxLength,IsOptional} from 'class-validator';
export class SupplierBillingQueryDto {@IsUUID() contractId!:string;}
export class SupplierBillingDto extends SupplierBillingQueryDto {
 @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
 @IsIn(['MONTHLY','SEASONAL']) volumeBasis!:string;
 @Matches(/^(0|[1-9][0-9]{0,3})([.][0-9]{1,4})?$/) minPercent!:string;
 @Matches(/^(0|[1-9][0-9]{0,3})([.][0-9]{1,4})?$/) maxTolerancePercent!:string;
 @IsIn(['FINAL','BASE_PLUS_INDEX']) priceMode!:string;
 @IsOptional() @Matches(/^-?(0|[1-9][0-9]{0,3})([.][0-9]{1,6})?$/) indexPercent?:string;
 @IsOptional() @IsString() @MaxLength(2000) indexSource?:string;
 @IsIn(['NET','GROSS']) taxTreatment!:string;
 @IsString() @Matches(/\S/) @MaxLength(2000) source!:string;
 @IsOptional() @IsUUID() previousId?:string;
 @IsString() @MaxLength(2000) reason!:string;
}

export class SupplierCycleQueryDto {@IsUUID() customerId!:string;}
