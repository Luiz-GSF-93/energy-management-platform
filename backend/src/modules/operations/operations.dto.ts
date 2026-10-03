import {IsIn,IsString,Length,IsOptional,IsUUID,IsInt,Min,IsISO8601} from 'class-validator';
export class OperationWriteDto {
 @IsUUID() requestId!:string;
 @IsInt() @Min(0) revision!:number;
 @IsString() @Length(3,500) reason!:string;
 @IsString() @Length(3,160) title!:string;
 @IsString() @Length(3,10000) description!:string;
 @IsIn(['LOW','NORMAL','HIGH','URGENT']) priority!:string;
 @IsOptional() @IsUUID() customerId?:string;
 @IsOptional() @IsUUID() unitId?:string;
 @IsString() @Length(1,100) responsibleId!:string;
 @IsOptional() @IsISO8601({strict:true}) dueAt?:string;
 @IsOptional() @IsISO8601({strict:true}) startsAt?:string;
 @IsOptional() @IsISO8601({strict:true}) endsAt?:string;
 @IsOptional() @IsUUID() documentId?:string;
 @IsOptional() @IsIn(['INVOICE','DOCUMENT','INFORMATION','VALIDATION','ACTIVITY']) requestType?:string;
 @IsOptional() @IsString() @Length(0,6000) tableText?:string;
}
export class OperationTransitionDto {
 @IsUUID() requestId!:string;
 @IsInt() @Min(1) revision!:number;
 @IsString() @Length(3,500) reason!:string;
 @IsIn(['IN_PROGRESS','WAITING','DONE','CANCELLED','REVIEW','PUBLISHED','DRAFT','ARCHIVED']) status!:string;
}
export class NotificationReadDto { @IsString() @Length(1,160) key!:string; }
