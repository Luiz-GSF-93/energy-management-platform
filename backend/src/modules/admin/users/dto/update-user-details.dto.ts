import {IsIn,IsString,MinLength,MaxLength} from 'class-validator';
export class UpdateUserDetailsDto {
 @IsString() @MinLength(2) @MaxLength(120) name!:string;
 @IsIn(['internal','external']) affiliationType!:'internal'|'external';
}
