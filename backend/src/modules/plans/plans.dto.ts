import {IsBoolean,IsDateString,IsInt,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength} from 'class-validator';
export class SavePlanDto {
 @IsString() @MinLength(2) @MaxLength(120) name!:string;
 @IsString() @MaxLength(2000) description!:string;
 @IsBoolean() active!:boolean;
 @IsInt() @Min(0) @Max(2147483647) documents_limit!:number;
 @IsInt() @Min(0) @Max(2147483647) max_consumer_units!:number;
 @IsInt() @Min(0) @Max(2147483647) max_users!:number;
 @IsBoolean() document_management!:boolean;
 @IsBoolean() advanced_analytics!:boolean;
 @IsBoolean() report_generation!:boolean;
 @IsBoolean() free_market_management!:boolean;
 @IsOptional() @IsInt() @Min(1) version?:number;
}
export class ApplyPlanDto {
 @IsUUID() planId!:string;
 @IsInt() @Min(1) version!:number;
 @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?:string;
 @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) renewalDate!:string;
}
