import {IsIn,IsUUID,Matches} from 'class-validator';
export class CurrentReportDto {
 @IsIn(['OPERATIONAL','EXECUTIVE']) kind!:'OPERATIONAL'|'EXECUTIVE';
 @IsUUID() customerId!:string;
 @IsUUID() unitId!:string;
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) from!:string;
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) to!:string;
}
export class CreateReportDto extends CurrentReportDto {
 @IsUUID() requestId!:string;
}
