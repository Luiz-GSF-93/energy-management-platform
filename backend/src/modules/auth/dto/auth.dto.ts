import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class RefreshSessionDto {
  @IsString() @MinLength(10) @MaxLength(4096) refresh_token!: string;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  name!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class AcceptInviteDto {
 @IsString() @MinLength(10) @MaxLength(128) password!:string;
}
