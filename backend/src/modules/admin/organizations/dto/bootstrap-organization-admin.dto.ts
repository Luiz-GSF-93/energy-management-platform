import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  USER_AFFILIATION_TYPES,
  UserAffiliationType,
} from '../../users/dto/update-user-affiliation.dto';

export class BootstrapOrganizationAdminDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsIn(USER_AFFILIATION_TYPES)
  affiliationType!: UserAffiliationType;
}
