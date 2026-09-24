import { IsIn } from 'class-validator';
export class UpdateMembershipStatusDto {
 @IsIn(['active','inactive'])
 status!: 'active'|'inactive';
}
