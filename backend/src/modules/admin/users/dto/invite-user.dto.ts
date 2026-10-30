import {
  IsEmail,
  IsOptional,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  MaxLength,
  MinLength,
} from 'class-validator';

export class InviteUserDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(300) @ArrayUnique() @IsUUID(undefined,{each:true}) permissionIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined,{each:true}) portalUnitIds?: string[];
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
