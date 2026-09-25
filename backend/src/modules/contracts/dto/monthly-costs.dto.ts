import {IsUUID,IsString,IsInt,Min,MaxLength,Matches,IsOptional,ValidateNested,IsObject,IsArray,ArrayMaxSize,IsBoolean,IsIn} from 'class-validator';
import {Type} from 'class-transformer';
export class MonthlyCostItemDto {
 @IsUUID() id!:string;
 @IsString() @Matches(/\S/) @MaxLength(200) label!:string;
 @IsIn(['CCEE','EXPOSURE','CHARGE','OTHER']) category!:string;
 @IsIn(['ACL','ACR']) scenario!:string;
 @IsIn(['COST','CREDIT']) effect!:string;
 @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$/) amount!:string;
 @IsString() @Matches(/\S/) @MaxLength(1000) source!:string;
 @IsIn(['INCLUDED','EXCLUDED','NOT_APPLICABLE','UNSPECIFIED']) taxTreatment!:string;
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
