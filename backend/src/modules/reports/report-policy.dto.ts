import {IsBoolean,IsInt,IsObject,IsOptional,IsUUID,Min} from 'class-validator';
export class SaveReportPolicyDto{
 @IsOptional() @IsUUID() id?:string;
 @IsOptional() @IsInt() @Min(1) expectedVersion?:number;
 @IsUUID() requestId!:string;
 @IsObject() config!:Record<string,unknown>;
}
export class ReportPolicyStateDto{
 @IsInt() @Min(1) expectedVersion!:number;
 @IsUUID() requestId!:string;
 @IsBoolean() enabled!:boolean;
}
