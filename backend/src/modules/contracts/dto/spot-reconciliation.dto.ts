import {IsUUID,Matches,IsIn,IsString,MaxLength,MinLength,IsOptional,Equals} from 'class-validator';
export class SpotReconciliationQueryDto {@IsUUID() contractId!:string;@Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) month!:string;}
export class SpotReconciliationDto extends SpotReconciliationQueryDto {
 @IsIn(['PENDING','APPROVED_NO_COST','APPROVED_TAX_RESERVATION']) status!:string;
 @IsUUID() documentId!:string;
 @Matches(/^[a-f0-9]{64}$/) sourceHash!:string;
 @IsString() @MinLength(20) @MaxLength(2000) reason!:string;
 @IsOptional() @IsUUID() previousId?:string;
 @Equals(true) confirmed!:boolean;
}
