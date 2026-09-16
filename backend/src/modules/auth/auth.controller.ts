import { Controller, Post, Get, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Tenant } from '../../common/decorators/tenant.decorator';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Public()
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('context')
  async getContext(@Tenant() tenant: TenantContext) {
    console.log('[AuthController] getContext - tenant:', tenant);
    return this.authService.getContext(tenant);
  }

  @Get('profile')
  async getProfile(@Tenant() tenant: TenantContext) {
    console.log('[AuthController] getProfile - tenant:', tenant);
    return this.authService.getProfile(tenant);
  }
}
