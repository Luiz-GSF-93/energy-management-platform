import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { Tenant } from '../../common/decorators/tenant.decorator';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';
import { AclAdmissionService } from './acl-admission.service';
@Controller('acl-admissions')
export class AclAdmissionController {
  constructor(private service: AclAdmissionService) {}
  @Get('access') @Header('Cache-Control', 'private, no-store') access(@Tenant() t: TenantContext) { return this.service.access(t); }
  @Get('candidates') @Header('Cache-Control', 'private, no-store') candidates(@Query() q: Record<string, unknown>, @Tenant() t: TenantContext) { return this.service.candidates(q, t); }
  @Get() @Header('Cache-Control', 'private, no-store') list(@Query() q: Record<string, unknown>, @Tenant() t: TenantContext) { return this.service.list(q, t); }
  @Get(':id') @Header('Cache-Control', 'private, no-store') one(@Param('id') id: string, @Tenant() t: TenantContext) { return this.service.one(id, t); }
  @Post() @Header('Cache-Control', 'private, no-store') create(@Body() b: unknown, @Tenant() t: TenantContext) { return this.service.create(b, t); }
}
@Controller('portal/acl-admissions')
export class AclAdmissionPortalController {
  constructor(private service: AclAdmissionService) {}
  @Get() @Header('Cache-Control', 'private, no-store') list(@Query() q: Record<string, unknown>, @Tenant() t: TenantContext) { return this.service.portal(q, t); }
}
