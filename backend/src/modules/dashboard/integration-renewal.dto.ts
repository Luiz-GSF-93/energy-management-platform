import {IsBoolean,IsInt,Matches,Max,Min,ValidateIf} from 'class-validator';
export class IntegrationRenewalDto {
 @IsInt() @Min(1) revision!:number;
 @Matches(/^\d{4}-\d{2}-\d{2}$/) issued_on!:string;
 @ValidateIf((_o,v)=>v!==null) @Matches(/^\d{4}-\d{2}-\d{2}$/) expires_on!:string|null;
 @IsBoolean() no_expiry!:boolean;
 @IsInt() @Min(1) @Max(60) reminder_days!:number;
}
