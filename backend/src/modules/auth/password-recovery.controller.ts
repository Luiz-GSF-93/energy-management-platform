import { Body, Controller, HttpCode, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { PasswordRecoveryService } from './password-recovery.service';

export class ForgotPasswordDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
export class ResetPasswordDto {
  @IsString()
  @Matches(/^[a-fA-F0-9]{32,128}$/)
  token_hash!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;
}

@Controller('auth')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class PasswordRecoveryController {
  constructor(private readonly recovery: PasswordRecoveryService) {}

  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  request(@Body() dto: ForgotPasswordDto, @Req() req: any) {
    return this.recovery.request(dto.email, req.ip || req.socket?.remoteAddress || 'unknown');
  }

  @Post('reset-password')
  @Public()
  @HttpCode(200)
  complete(@Body() dto: ResetPasswordDto, @Req() req: any) {
    return this.recovery.complete(dto.token_hash, dto.password, req.ip || req.socket?.remoteAddress || 'unknown');
  }
}
