import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email inválido' })
  email: string;

  @IsString({ message: 'Senha deve ser uma string' })
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  oldPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Email inválido' })
  email: string;
}

export class JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokenResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    role: string;
    name: string;
    tenant_id: string;
    tenant_name: string;
  };
}
