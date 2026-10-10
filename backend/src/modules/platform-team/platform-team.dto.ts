import {IsBoolean,IsEmail,IsIn,IsInt,IsString,MaxLength,Min,MinLength} from 'class-validator';
import {TEAM_PROFILES} from './platform-team.permissions';
export class InsertTeamDto{
 @IsEmail() @MaxLength(254) email!:string;
 @IsString() @MinLength(1) @MaxLength(80) firstName!:string;
 @IsString() @MinLength(1) @MaxLength(120) lastName!:string;
 @IsIn(TEAM_PROFILES) profile!:typeof TEAM_PROFILES[number];
 @IsString() @MinLength(5) @MaxLength(1000) reason!:string;
}
export class UpdateTeamDto{
 @IsInt() @Min(1) revision!:number;
 @IsBoolean() active!:boolean;
 @IsString() @MinLength(1) @MaxLength(80) firstName!:string;
 @IsString() @MinLength(1) @MaxLength(120) lastName!:string;
 @IsIn(TEAM_PROFILES) profile!:typeof TEAM_PROFILES[number];
 @IsString() @MinLength(5) @MaxLength(1000) reason!:string;
}
