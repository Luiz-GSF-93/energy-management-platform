import {
  IsEmail,
  IsOptional,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class InviteUserDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsUUID()
  roleId!: string;

  @IsIn(['internal', 'external'])
  affiliationType!: 'internal' | 'external';
}
