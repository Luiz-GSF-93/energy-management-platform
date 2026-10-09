import {IsArray,ArrayUnique,ArrayMaxSize,IsIn,IsInt,IsString,IsUUID,IsBoolean,IsDateString,Matches,Min,Max,MinLength,MaxLength} from 'class-validator';
export const portalModules=['reports','forecasts','energy_prices','acl','documents','bot'] as const;
export class PortalLicenseDto {
 @IsUUID() customerId!:string;
 @IsInt() @Min(0) @Max(2147483647) revision!:number;
 @IsIn(['ACTIVE','SUSPENDED','CANCELLED']) status!:string;
 @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) starts!:string;
 @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) ends!:string;
 @IsArray() @ArrayUnique() @ArrayMaxSize(6) @IsIn(portalModules,{each:true}) modules!:string[];
 @IsInt() @Min(0) @Max(2147483647) maxUsers!:number;
 @IsInt() @Min(0) @Max(2147483647) maxUnits!:number;
 @IsString() @MinLength(3) @MaxLength(1000) reason!:string;
}
export class PortalPolicyDto {
 @IsInt() @Min(0) @Max(2147483647) revision!:number;
 @IsBoolean() enabled!:boolean;
 @IsString() @MinLength(3) @MaxLength(1000) reason!:string;
}
export class ClientAdditionDto {
 @IsUUID() id!:string;
 @IsInt() @Min(0) @Max(2147483647) revision!:number;
 @IsInt() @Min(1) @Max(2147483647) slots!:number;
 @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) starts!:string;
 @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) ends!:string;
 @IsIn(['ACTIVE','CANCELLED']) status!:string;
 @IsString() @MinLength(3) @MaxLength(500) reference!:string;
 @IsString() @MinLength(3) @MaxLength(1000) reason!:string;
}
