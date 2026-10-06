import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { Tenant } from '../../common/decorators/tenant.decorator';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';
import { AclAdmissionService } from './acl-admission.service';
@Controller('acl-admissions')
export class AclAdmissionController {
  constructor(private service: AclAdmissionService) {}
  @Get('access') @Header('Cache-Control', 'private, no-store') access(@Tenant() t: TenantContext) { return this.service.access(t); }
  @Get('candidates') @Header('Cache-Control', 'private, no-store') candidates(@Query() q: Record<string, unknown>, @Tenant() t: TenantContext) { return this.service.candidates(q, t); }
  @Get('performance') @Header('Cache-Control', 'private, no-store') performance(@Query() q: Record<string, unknown>, @Tenant() t: TenantContext) { return this.service.performance(q,t); }
  @Get() @Header('Cache-Control', 'private, no-store') list(@Query() q: Record<string, unknown>, @Tenant() t: TenantContext) { return this.service.list(q, t); }
  @Get(':id') @Header('Cache-Control', 'private, no-store') one(@Param('id') id: string, @Tenant() t: TenantContext) { return this.service.one(id, t); }
  @Post() @Header('Cache-Control', 'private, no-store') create(@Body() b: unknown, @Tenant() t: TenantContext) { return this.service.create(b, t); }
  @Post(':id/work') @Header('Cache-Control', 'private, no-store') work(@Param('id') id: string, @Body() b: unknown, @Tenant() t: TenantContext) { return this.service.work(id, b, t); }
  @Post(':id/heartbeat') @Header('Cache-Control', 'private, no-store') heartbeat(@Param('id') id: string, @Body() b: unknown, @Tenant() t: TenantContext) { return this.service.heartbeat(id, b, t); }
  @Get(':id/evidence') @Header('Cache-Control', 'private, no-store') evidence(@Param('id') id: string, @Query() q: Record<string,unknown>, @Tenant() t: TenantContext) { return this.service.evidenceList(id,q,t); }
  @Get(':id/evidence-sources') @Header('Cache-Control', 'private, no-store') sources(@Param('id') id: string, @Query() q: Record<string,unknown>, @Tenant() t: TenantContext) { return this.service.evidenceList(id,q,t,true); }
  @Get(':id/history-preview/:document') @Header('Cache-Control','private, no-store') historyPreview(@Param('id') id:string,@Param('document') document:string,@Tenant() t:TenantContext){return this.service.historyPreview(id,document,t);}
  @Post(':id/history-simulation') @Header('Cache-Control','private, no-store') historySimulation(@Param('id') id:string,@Body() b:unknown,@Tenant() t:TenantContext){return this.service.historySimulation(id,b,t);}
  @Post(':id/evidence') @Header('Cache-Control', 'private, no-store') evidenceCommand(@Param('id') id: string, @Body() b: unknown, @Tenant() t: TenantContext) { return this.service.evidenceCommand(id,b,t); }
  @Get(':id/closure') @Header('Cache-Control', 'private, no-store') closure(@Param('id') id: string, @Tenant() t: TenantContext) { return this.service.closureRead(id,t); }
  @Post(':id/closure') @Header('Cache-Control', 'private, no-store') closureCommand(@Param('id') id: string, @Body() b: unknown, @Tenant() t: TenantContext) { return this.service.closureCommand(id,b,t); }
  @Post(':id/reopen') @Header('Cache-Control', 'private, no-store') reopen(@Param('id') id: string, @Body() b: unknown, @Tenant() t: TenantContext) { return this.service.reopen(id,b,t); }
}
@Controller('portal/acl-admissions')
export class AclAdmissionPortalController {
  constructor(private service: AclAdmissionService) {}
  @Get() @Header('Cache-Control', 'private, no-store') list(@Query() q: Record<string, unknown>, @Tenant() t: TenantContext) { return this.service.portal(q, t); }
}
