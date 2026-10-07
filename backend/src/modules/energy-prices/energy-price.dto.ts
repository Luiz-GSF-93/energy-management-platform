import {Equals,IsBoolean,IsOptional,IsString,IsUUID,Matches,MaxLength} from 'class-validator';
export class EnergyPriceQueryDto{
 @Matches(/^(20[0-9]{2}|2100)$/) year!:string;
 @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,100}$/) customerId?:string;
 @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,100}$/) unitId?:string;
}
export class EnergyPricePublishDto{
 @IsUUID() studyId!:string;
 @Matches(/^[0-9a-f]{64}$/) hash!:string;
 @IsUUID() requestId!:string;
 @IsBoolean() @Equals(true) checked!:boolean;
}
