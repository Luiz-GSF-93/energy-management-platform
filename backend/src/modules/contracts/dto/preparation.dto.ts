import {IsUUID,Matches} from 'class-validator';
export class PreparationQueryDto {
 @IsUUID() consumerUnitId!:string;
 @Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) month!:string;
}
