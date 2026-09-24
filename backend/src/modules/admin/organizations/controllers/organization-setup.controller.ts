import { Body, Controller, ForbiddenException, Get, InternalServerErrorException, Param, Patch, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PlatformScope } from '../../../../common/decorators/platform-scope.decorator';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { PLATFORM_OPERATE_PERMISSION } from '../../../../common/services/platform-operation';
import { SupabaseService } from '../../../../services/supabase.service';
import { RequestWithAuthenticatedUser } from '../../../../common/interfaces/authenticated-user.interface';

export class OrganizationRegistrationDto {
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(200) tradeName?: string;
  @IsOptional() @Matches(/^(?:[0-9A-Z]{12}[0-9]{2})?$/) taxId?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsString() @MaxLength(30) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(200) contactName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(200) responsibleName?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

@Controller('admin/organizations')
@PlatformScope()
export class OrganizationSetupController {
  constructor(private readonly supabase: SupabaseService) {}

  @Post(':id/operate')
  @RequirePermission([PLATFORM_OPERATE_PERMISSION])
  async enter(@Param('id') id: string, @Req() req: RequestWithAuthenticatedUser) {
    const { data, error } = await this.supabase.getClient().rpc('enter_platform_organization', {
      target_organization_id: id, target_user_id: req.authenticatedUser.userId,
      request_ip: req.ip, request_agent: req.get('user-agent') || null,
    });
    if (error || !Array.isArray(data) || data.length !== 1) {
      throw new ForbiddenException('Não foi possível entrar na organização. Verifique o cadastro e os papéis organizacionais.');
    }
    return data[0];
  }

  @Patch(':id/registration')
  @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_UPDATE])
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async registration(@Param('id') id: string, @Body() dto: OrganizationRegistrationDto, @Req() req: RequestWithAuthenticatedUser) {
    const { data, error } = await this.supabase.getClient().rpc('update_organization_registration', {
      target_organization_id: id, target_user_id: req.authenticatedUser.userId,
      target_registration: dto, request_ip: req.ip, request_agent: req.get('user-agent') || null,
    });
    if (error) throw new InternalServerErrorException('Não foi possível salvar os dados cadastrais.');
    return data;
  }
}
