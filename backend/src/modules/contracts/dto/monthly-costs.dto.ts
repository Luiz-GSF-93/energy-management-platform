import {MinLength,IsUUID,IsString,IsInt,Min,MaxLength,Matches,IsOptional,ValidateNested,IsObject,IsArray,ArrayMaxSize,IsBoolean,IsIn} from 'class-validator';
import {Type} from 'class-transformer';
export class SupplierIcmsDto {
 @IsUUID() parameterId!:string;
 @IsInt() @Min(1) revision!:number;
 @IsString() @Matches(/^(0|[1-9][0-9]?)([.][0-9]{1,6})?$/) rate!:string;
 @IsString() @Matches(/\S/) @MaxLength(1000) reason!:string;
}
export class MonthlyCostItemDto {
 @IsOptional() @IsObject() @ValidateNested() @Type(()=>SupplierIcmsDto) supplierIcms?:SupplierIcmsDto;
 @IsUUID() id!:string;
 @IsString() @Matches(/\S/) @MaxLength(200) label!:string;
 @IsIn(['CCEE','EXPOSURE','CHARGE','OTHER','SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY','DISTRIBUTOR_ADJUSTMENT']) category!:string;
 @IsIn(['ACL','ACR']) scenario!:string;
 @IsIn(['COST','CREDIT']) effect!:string;
 @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$/) amount!:string;
 @IsString() @Matches(/\S/) @MaxLength(1000) source!:string;
 @IsIn(['INCLUDED','EXCLUDED','NOT_APPLICABLE','UNSPECIFIED','RESERVED']) taxTreatment!:string;
 @IsOptional() @IsString() @MaxLength(1000) taxReservationReason?:string;
}
export class MonthlyCostsPayloadDto {
 @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>MonthlyCostItemDto) items!:MonthlyCostItemDto[];
 @IsBoolean() noCosts!:boolean;
}
export class MonthlyCostQueryDto { @IsUUID() consumerUnitId!:string; @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) month!:string; }
export class MonthlyCostDto extends MonthlyCostQueryDto {
 @IsObject() @ValidateNested() @Type(()=>MonthlyCostsPayloadDto) costs!:MonthlyCostsPayloadDto;
 @IsString() @Matches(/\S/) @MaxLength(2000) sourceReference!:string;
 @IsString() @MaxLength(2000) notes!:string;
 @IsOptional() @IsUUID() previousId?:string|null;
 @IsString() @MaxLength(2000) correctionReason!:string;
}
export class MonthlyCostRevisionDto { @IsInt() @Min(1) revision!:number; }
export class UpdateMonthlyCostDto extends MonthlyCostDto { @IsInt() @Min(1) revision!:number; }

export class CostAbsenceDto extends MonthlyCostQueryDto {
 @IsIn(['ACL','ACR']) scenario!:'ACL'|'ACR';
 @IsBoolean() absent!:boolean;
 @IsOptional() @IsUUID() previousId?:string|null;
 @IsOptional() @IsUUID() costId?:string|null;
 @IsOptional() @IsInt() @Min(1) costRevision?:number|null;
 @IsString() @Matches(/\S/) @MaxLength(2000) sourceReference!:string;
 @IsString() @MinLength(20) @MaxLength(2000) reason!:string;
}
