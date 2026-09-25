import {IsString,IsUUID,IsIn,IsInt,Min,MaxLength,Matches,IsDateString,IsOptional} from 'class-validator';
export class ParameterDto {
 @IsUUID() consumerUnitId!:string;
 @IsIn(['TARIFF','TAX','COST']) kind!:string;
 @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,39}$/) componentCode!:string;
 @IsString() @Matches(/\S/) @MaxLength(200) label!:string;
 @IsIn(['ACL','ACR']) scenario!:string;
 @IsIn(['ALL','PEAK','OFF_PEAK']) timeBand!:string;
 @IsIn(['BRL_KWH','BRL_MWH','BRL_KW','BRL_KVARH','BRL_MONTH','PERCENT']) measure!:string;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) amount?:string|null;
 @IsIn(['NET','GROSS','INSIDE','OUTSIDE','INCLUDED','EXEMPT','NOT_APPLICABLE']) treatment!:string;
 @IsString() @MaxLength(500) includedTaxes!:string;
 @IsString() @MaxLength(4096) baseRule!:string;
 @IsIn(['DEBIT','CREDIT']) direction!:string;
 @IsString() @Matches(/\S/) @MaxLength(2000) source!:string;
 @IsString() @MaxLength(4096) notes!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
}
export class UpdateParameterDto extends ParameterDto { @IsInt() @Min(1) revision!:number; }
export class ParameterRevisionDto { @IsInt() @Min(1) revision!:number; }
export class RetireParameterDto extends ParameterRevisionDto { @IsString() @Matches(/\S/) @MaxLength(2000) reason!:string; }
