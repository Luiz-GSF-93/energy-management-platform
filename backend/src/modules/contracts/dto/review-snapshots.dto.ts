import {IsString,IsUUID,MaxLength,MinLength,IsOptional,Matches} from 'class-validator';
import {PreparationQueryDto} from './preparation.dto';
export class CreateReviewSnapshotDto extends PreparationQueryDto {
 @IsUUID() requestId!:string;
 @IsString() @MinLength(3) @MaxLength(500) note!:string;
}
export class ReviewSnapshotQueryDto extends PreparationQueryDto {
 @IsOptional() @Matches(/^[1-9][0-9]{0,8}$/) beforeVersion?:string;
}
