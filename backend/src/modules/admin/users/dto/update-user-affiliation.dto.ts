import { IsIn, IsString } from 'class-validator';

export const USER_AFFILIATION_TYPES = ['internal', 'external'] as const;
export type UserAffiliationType = (typeof USER_AFFILIATION_TYPES)[number];

export class UpdateUserAffiliationDto {
  @IsString()
  @IsIn(USER_AFFILIATION_TYPES)
  affiliationType!: UserAffiliationType;
}
