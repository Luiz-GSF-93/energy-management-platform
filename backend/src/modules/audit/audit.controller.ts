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
 @Post('alerts/:id') @RequirePermission([AUDIT.review]) decide(@Req() r:RequestWithTenant,@Param('id') id:string,@Body() b:unknown){return this.audit.decide(r,false,id,b);}
 @Post('presence') presence(@Req() r:RequestWithTenant,@Body() b:unknown){return this.audit.presence(r,b);}
}
@Controller('admin/audit') @PlatformScope()
export class GlobalAuditController{
 constructor(private readonly audit:AuditWorkspaceService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([AUDIT.global]) read(@Req() r:RequestWithTenant,@Query() q:Record<string,unknown>){return this.audit.read(r,true,q);}
 @Post('alerts/:id') @RequirePermission([AUDIT.globalReview]) decide(@Req() r:RequestWithTenant,@Param('id') id:string,@Body() b:unknown){return this.audit.decide(r,true,id,b);}
 @Post('presence') presence(@Req() r:RequestWithTenant,@Body() b:unknown){return this.audit.presence(r,b);}
}
