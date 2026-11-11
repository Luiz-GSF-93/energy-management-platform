import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';
import {AuditWorkspaceService} from './audit.service';
import {AUDIT} from './audit.model';
@Controller('audit')
export class OrganizationAuditController{
 constructor(private readonly audit:AuditWorkspaceService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.view]) read(@Req() r:RequestWithTenant,@Query() q:Record<string,unknown>){return this.audit.read(r,false,q);}
 @Get('alert-count') @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.view]) count(@Req() r:RequestWithTenant){return this.audit.alertCount(r,false);}
 @Get('retention') @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.view]) retention(@Req() r:RequestWithTenant){return this.audit.retention(r,false);}
 @Get('alerts/:id/evidence') @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.view]) evidence(@Req() r:RequestWithTenant,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.audit.evidence(r,false,id,q);}
 @Post('alerts/:id') @RequirePermission([AUDIT.review]) decide(@Req() r:RequestWithTenant,@Param('id') id:string,@Body() b:unknown){return this.audit.decide(r,false,id,b);}
 @Post('presence') presence(@Req() r:RequestWithTenant,@Body() b:unknown){return this.audit.presence(r,b);}
}
@Controller('admin/audit') @PlatformScope()
export class GlobalAuditController{
 constructor(private readonly audit:AuditWorkspaceService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.global]) read(@Req() r:RequestWithTenant,@Query() q:Record<string,unknown>){return this.audit.read(r,true,q);}
 @Get('alert-count') @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.global]) count(@Req() r:RequestWithTenant){return this.audit.alertCount(r,true);}
 @Get('retention') @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.global]) retention(@Req() r:RequestWithTenant){return this.audit.retention(r,true);}
 @Post('retention') retentionAct(@Req() r:RequestWithTenant,@Body() b:unknown){return this.audit.retentionAct(r,b);}
 @Get('alerts/:id/evidence') @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.global]) evidence(@Req() r:RequestWithTenant,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.audit.evidence(r,true,id,q);}
 @Post('alerts/:id') @RequirePermission([AUDIT.globalReview]) decide(@Req() r:RequestWithTenant,@Param('id') id:string,@Body() b:unknown){return this.audit.decide(r,true,id,b);}
 @Post('presence') presence(@Req() r:RequestWithTenant,@Body() b:unknown){return this.audit.presence(r,b);}
}
