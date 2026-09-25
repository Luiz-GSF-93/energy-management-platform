import {IsUUID,IsString,IsInt,Min,MaxLength,Matches,IsOptional,ValidateNested,IsObject} from 'class-validator';
import {Type} from 'class-transformer';
export class MonthlyMeasurementsDto {
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) consumptionTotal?:string|null;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) consumptionPeak?:string|null;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) consumptionOffPeak?:string|null;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) demandSingle?:string|null;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) demandPeak?:string|null;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) demandOffPeak?:string|null;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) reactiveTotal?:string|null;
}
export class BilledDemandScenarioDto {
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) single?:string|null;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) peak?:string|null;
 @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/) offPeak?:string|null;
 @IsString() @Matches(/\S/) @MaxLength(2000) source!:string;
}
export class BilledDemandDto {
 @IsOptional() @IsObject() @ValidateNested() @Type(()=>BilledDemandScenarioDto) ACL?:BilledDemandScenarioDto|null;
 @IsOptional() @IsObject() @ValidateNested() @Type(()=>BilledDemandScenarioDto) ACR?:BilledDemandScenarioDto|null;
}
export class MonthlyInputQueryDto { @IsUUID() consumerUnitId!:string; @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) month!:string; }
export class MonthlyInputDto extends MonthlyInputQueryDto {
 @IsObject() @ValidateNested() @Type(()=>MonthlyMeasurementsDto) measurements!:MonthlyMeasurementsDto;
 @IsOptional() @IsObject() @ValidateNested() @Type(()=>BilledDemandDto) billedDemand?:BilledDemandDto|null;
 @IsString() @Matches(/\S/) @MaxLength(2000) sourceReference!:string;
 @IsString() @MaxLength(2000) notes!:string;
 @IsOptional() @IsUUID() previousId?:string|null;
 @IsString() @MaxLength(2000) correctionReason!:string;
}
export class MonthlyInputRevisionDto { @IsInt() @Min(1) revision!:number; }
export class UpdateMonthlyInputDto extends MonthlyInputDto { @IsInt() @Min(1) revision!:number; }
