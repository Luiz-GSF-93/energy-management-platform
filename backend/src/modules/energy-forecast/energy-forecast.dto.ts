import {Type} from 'class-transformer';
import {ArrayMaxSize,ArrayMinSize,IsArray,IsBoolean,IsIn,IsInt,IsNumber,IsOptional,IsString,IsUUID,Length,Matches,Max,Min,ValidateNested} from 'class-validator';
class SourceDto { @IsOptional() @IsUUID() admissionId?:string; @IsOptional() @IsUUID() evidenceId?:string; @IsOptional() @IsUUID() historyId?:string; }
class ExpansionDto {
 @IsString() @Length(3,160) description!:string;
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) startMonth!:string;
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) endMonth!:string;
 @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/) monthlyKwh!:string;
 @IsString() @Length(20,1000) justification!:string;
}
class ReadingPeriodDto {
 @Matches(/^20\d{2}-(0[1-9]|1[0-2])$/) month!:string;
 @Matches(/^20\d{2}-\d{2}-\d{2}$/) previousReading!:string;
 @Matches(/^20\d{2}-\d{2}-\d{2}$/) currentReading!:string;
 @IsString() @Length(1,160) evidenceId!:string;
 @IsInt() @Min(1) @Max(1000) page!:number;
}
class WeatherDto {
 @IsNumber() @Min(-34) @Max(6) latitude!:number;
 @IsNumber() @Min(-74) @Max(-28) longitude!:number;
 @IsBoolean() consent!:boolean;
 @IsOptional() @IsIn(['ANNUAL_CYCLE_2']) assessment?:'ANNUAL_CYCLE_2';
 @IsOptional() @IsIn(['LOW','UNKNOWN']) sensitivity?:'LOW'|'UNKNOWN';
 @IsOptional() @IsString() @Length(20,1000) premiseNote?:string;
 @IsOptional() @IsArray() @ArrayMinSize(12) @ArrayMaxSize(36) @ValidateNested({each:true}) @Type(()=>ReadingPeriodDto) readingPeriods?:ReadingPeriodDto[];
}
export class PrepareForecastDto {
 @IsUUID() requestId!:string; @IsUUID() customerId!:string; @IsUUID() unitId!:string;
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) asOfMonth!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(36) @ValidateNested({each:true}) @Type(()=>SourceDto) sources!:SourceDto[];
 @IsArray() @ArrayMaxSize(20) @ValidateNested({each:true}) @Type(()=>ExpansionDto) expansions!:ExpansionDto[];
 @IsOptional() @ValidateNested() @Type(()=>WeatherDto) weather?:WeatherDto;
}
class HistoryRowDto {
 @Matches(/^20\d{2}-(0[1-9]|1[0-2])$/) month!:string;
 @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/) consumptionKwh!:string;
 @IsInt() @Min(1) @Max(62) days!:number;
 @IsInt() @Min(1) @Max(1000) page!:number;
 @IsString() @Length(3,180) source!:string;
}
export class RecordHistoryDto {
 @IsUUID() requestId!:string; @IsUUID() documentId!:string;
 @Matches(/^[a-f0-9]{64}$/) sourceHash!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(36) @ValidateNested({each:true}) @Type(()=>HistoryRowDto) rows!:HistoryRowDto[];
 @IsBoolean() checkedPdf!:boolean;
 @IsString() @Length(20,1000) note!:string;
}
export class ValidateHistoryDto {
 @IsUUID() requestId!:string; @IsString() @Length(20,1000) note!:string;
}
export class TransitionForecastDto {
 @IsUUID() requestId!:string; @Matches(/^[a-f0-9]{64}$/) payloadHash!:string;
 @IsIn(['VALIDATED','PUBLISHED']) action!:'VALIDATED'|'PUBLISHED';
 @IsString() @Length(20,1000) note!:string;
}
