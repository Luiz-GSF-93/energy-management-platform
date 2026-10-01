import {Type} from 'class-transformer';
import {ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsBoolean,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,MaxLength,Min,ValidateNested} from 'class-validator';
export class LibraryItemDto {
 @IsIn(['TE','TUSD_ENERGY','TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED','REACTIVE']) component!:string;
 @IsIn(['PEAK','OFF_PEAK','ALL']) band!:string;
 @IsIn(['BRL_KWH','BRL_MWH','BRL_KW','BRL_KVARH']) measure!:string;
 @Matches(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/) value!:string;
 @IsString() @Matches(/\S/) @MaxLength(150) label!:string;
}
export class LibraryProfileDto {
 @IsString() @Matches(/\S/) @MaxLength(150) distributor!:string;
 @IsIn(['A','B']) group!:string;
 @IsString() @Matches(/^[A-Z0-9]{1,5}$/) subgroup!:string;
 @IsIn(['GREEN','BLUE','CONVENTIONAL','WHITE']) modality!:string;
 @IsString() @Matches(/\S/) @MaxLength(100) category!:string;
 @IsString() @Matches(/\S/) @MaxLength(100) consumptionClass!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
 @IsString() @Matches(/\S/) @MaxLength(1500) source!:string;
 @IsString() @MaxLength(1500) notes!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(()=>LibraryItemDto) items!:LibraryItemDto[];
}
export class LibraryWriteDto extends LibraryProfileDto {
 @IsOptional() @IsUUID() previousId?:string;
 @IsString() @Matches(/\S/) @MaxLength(1500) reason!:string;
}
export class LibraryTaxDto {
 @IsIn(['ICMS','PIS','COFINS']) code!:string;
 @Matches(/^(0|[1-9][0-9]?)(\.[0-9]{1,6})?$/) rate!:string;
 @IsIn(['INSIDE','OUTSIDE']) mode!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsString({each:true}) included!:string[];
}
export class LibraryApplyDto {
 @IsUUID() consumerUnitId!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
 @IsIn(['ACL','ACR']) scenario!:string;
 @IsBoolean() includedTaxes!:boolean;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsString({each:true}) selected!:string[];
 @IsArray() @ArrayMaxSize(3) @ArrayUnique() @IsIn(['ICMS','PIS','COFINS'],{each:true}) embeddedCodes!:string[];
 @IsArray() @ArrayMaxSize(3) @ValidateNested({each:true}) @Type(()=>LibraryTaxDto) taxes!:LibraryTaxDto[];
 @Matches(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$/) cip!:string;
 @Matches(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$/) other!:string;
 @IsString() @MaxLength(200) otherLabel!:string;
 @IsOptional() @Matches(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/) aclEnergyPrice?:string;
 @IsString() @MaxLength(1000) aclSource!:string;
 @IsString() @Matches(/\S/) @MaxLength(1500) reason!:string;
 @IsBoolean() expiredConfirmed!:boolean;
 @IsString() @MaxLength(1000) expiredReason!:string;
}
