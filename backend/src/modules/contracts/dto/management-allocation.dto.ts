import {Type} from 'class-transformer';
import {IsUUID,IsString,Matches,MaxLength,IsArray,ArrayMinSize,ArrayMaxSize,ValidateNested,IsOptional,IsIn} from 'class-validator';
export class ManagementAllocationQueryDto {@IsUUID() contractId!:string;@Matches(/^(20|21)\d{2}-(0[1-9]|1[0-2])$/) month!:string;}
class AllocationItem {@IsUUID() consumerUnitId!:string;@IsString() @Matches(/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/) percentage!:string;}
export class ManagementAllocationDto extends ManagementAllocationQueryDto {
 @IsIn(['PER_UNIT']) fixedFeeBasis!:'PER_UNIT';
 @IsArray() @ArrayMinSize(0) @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>AllocationItem) allocations!:AllocationItem[];
 @IsString() @Matches(/\S/) @MaxLength(2000) source!:string;
 @IsOptional() @IsUUID() previousId?:string;
 @IsString() @MaxLength(2000) reason!:string;
}
