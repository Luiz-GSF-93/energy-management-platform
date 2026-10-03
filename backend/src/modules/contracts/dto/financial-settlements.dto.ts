import {Equals,IsBoolean,IsOptional,IsString,IsUUID,Matches,MaxLength,MinLength} from 'class-validator';
import {PreparationQueryDto} from './preparation.dto';
export class PrepareFinancialSettlementDto extends PreparationQueryDto {
 @IsUUID() requestId!:string;
 @IsString() @MinLength(20) @MaxLength(2000) note!:string;
}
export class FinancialSettlementTransitionDto {
 @Matches(/^[0-9a-f]{64}$/) payloadHash!:string;
 @IsString() @MinLength(20) @MaxLength(2000) note!:string;
 @IsBoolean() @Equals(true) acknowledgeReservations!:boolean;
}
export class PublishedFinancialQueryDto {
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) from!:string;
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) to!:string;
 @IsOptional() @IsUUID() customerId?:string;
}
export class PortalFinancialQueryDto {
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) from!:string;
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) to!:string;
}

export class FinancialAnalyticsQueryDto extends PublishedFinancialQueryDto {
 @IsOptional() @IsUUID() unitId?:string;
 @IsOptional() @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) compareFrom?:string;
 @IsOptional() @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) compareTo?:string;
 @IsOptional() @IsUUID() compareUnitId?:string;
}
