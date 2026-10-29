import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query,Req} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {CASES,ASSIGNED} from './platform-workflows.service';
import {supportPage} from './central-support.model';
import {CentralSupportService} from './central-support.service';
@Controller('central-support')
export class CentralSupportController{
 constructor(private readonly service:CentralSupportService){}
 @Get() @Header('Cache-Control','no-store') list(@Tenant() t:TenantContext,@Query('page') page?:string){return this.service.list(t,supportPage(page));}
 @Post(':id/draft') draft(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.action(t,'draft',id,b);}
 @Post(':id/authorize') @Header('Cache-Control','no-store') authorize(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.action(t,'authorize',id,b);}
 @Post(':id/submit') submit(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.action(t,'submit',id,b);}
}
@Controller('admin/central-support') @PlatformScope()
export class CentralSupportPlatformController{
 constructor(private readonly service:CentralSupportService){}
 @Get() @RequirePermission([CASES,ASSIGNED]) list(@Req() r:RequestWithAuthenticatedUser,@Query('page') page?:string){return this.service.platform(r.authenticatedUser.userId,'list',null,{page:supportPage(page)});}
 @Get('policy/:id') @RequirePermission(['af285642-16b0-405a-982c-58de1a10f987']) policyRead(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string){return this.service.platform(r.authenticatedUser.userId,'policy_read',id);}
 @Post('policy/:id') @RequirePermission(['af285642-16b0-405a-982c-58de1a10f987']) policy(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'policy',id,b);}
 @Post('activation') @RequirePermission(['af285642-16b0-405a-982c-58de1a10f987']) activate(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'activate',null,b);}
 @Post(':id/triage') @RequirePermission([CASES]) triage(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'triage',id,b);}
 @Post(':id/reply') @RequirePermission([CASES,ASSIGNED]) reply(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'reply',id,b);}
 @Post('communications/:id/retry') @RequirePermission([CASES]) retry(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'retry_email',id,b);}
}
