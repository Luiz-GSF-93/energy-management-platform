import {IsIn,IsInt,IsObject,IsUUID,Min,Max,IsArray,ArrayMaxSize,IsOptional} from 'class-validator';
export class EntryDraftDto {
 @IsUUID() customerId!:string;
 @IsIn(['distributor','supply','management','services']) kind!:string;
 @IsOptional() @IsArray() @ArrayMaxSize(5) @IsInt({each:true}) @Min(0,{each:true}) @Max(4,{each:true}) deferredSteps?:number[];
 @IsObject() payload!:Record<string,unknown>;
}
export class UpdateEntryDraftDto extends EntryDraftDto { @IsInt() @Min(1) revision!:number; }
export class EntryRevisionDto { @IsInt() @Min(1) revision!:number; }
