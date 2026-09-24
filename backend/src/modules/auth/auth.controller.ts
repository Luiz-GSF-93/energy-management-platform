import { Controller, Post, Get, Body, Param, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, AcceptInviteDto } from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Tenant } from '../../common/decorators/tenant.decorator';
import { Access } from '../../common/decorators/access-context.decorator';
import { PlatformScope } from '../../common/decorators/platform-scope.decorator';
import { RecoveryEndpoint } from '../../common/decorators/recovery-endpoint.decorator';
import {
  AccessContext,
  TenantContext,
} from '../../common/interfaces/tenant-context.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('accept-invite')
  @RecoveryEndpoint()
  @UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
  async acceptInvite(@Body() dto:AcceptInviteDto,@Req() request:any) {
    return this.authService.acceptInvite(request.authenticatedUser.userId,dto.password);
  }

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

  @Get('platform-context')
  @PlatformScope()
  async getPlatformContext(
    @Access() access: AccessContext,
  ) {
    return {
      scope: access.scope,
      user: {
        id: access.userId,
        email: access.email,
      },
      role: access.role,
      roleId: access.roleId,
      permissions: access.permissions,
    };
  }

  @Get('profile')
  async getProfile(@Tenant() tenant: TenantContext) {
    console.log('[AuthController] getProfile - tenant:', tenant);
    return this.authService.getProfile(tenant);
  }

  @Get('my-organizations')
  @RecoveryEndpoint()
  async getMyOrganizations(@Req() request: any): Promise<any> {
    return this.authService.getMyOrganizations(
      request.authenticatedUser.userId,
    );
  }

  @Post('switch-organization/:organizationId')
  @RecoveryEndpoint()
  async switchOrganization(
    @Param('organizationId') organizationId: string,
    @Req() request: any,
  ): Promise<any> {
    const ipAddress = request.ip || request.socket?.remoteAddress;
    const userAgent = request.get('User-Agent');
    return this.authService.switchOrganization(
      request.authenticatedUser.userId,
      organizationId,
      ipAddress,
      userAgent,
    );
  }
}
