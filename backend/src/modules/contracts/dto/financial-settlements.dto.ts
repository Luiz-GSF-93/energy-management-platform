import {Equals,IsBoolean,IsString,IsUUID,Matches,MaxLength,MinLength} from 'class-validator';
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
