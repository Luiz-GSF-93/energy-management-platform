import {FileInterceptor} from '@nestjs/platform-express';
import {CentralSupportThreadService} from './central-support-thread.service';
import {DocumentFile} from '../documents/services/document-file';
import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query,Req,UploadedFile,UseInterceptors} from '@nestjs/common';
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
 constructor(private readonly service:CentralSupportService,private readonly threads:CentralSupportThreadService){}

 @Get(':id/thread') @Header('Cache-Control','no-store') thread(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Query('page') page?:string){return this.threads.read(this.threads.identity(t),id,supportPage(page));}
 @Post(':id/thread') replyThread(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.threads.write(this.threads.identity(t),id,b);}
 @Post(':id/attachments') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5242880,files:1,fields:0}})) upload(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@UploadedFile() f:DocumentFile){return this.threads.upload(this.threads.identity(t),id,f);}
 @Get(':id/attachments/:fileId') @Header('Cache-Control','no-store') download(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Param('fileId',new ParseUUIDPipe()) fileId:string){return this.threads.download(this.threads.identity(t),id,fileId);}
 @Post(':id/attachments/:fileId/discard') discard(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Param('fileId',new ParseUUIDPipe()) fileId:string){return this.threads.discard(this.threads.identity(t),id,fileId);}
 @Get() @Header('Cache-Control','no-store') list(@Tenant() t:TenantContext,@Query('page') page?:string){return this.service.list(t,supportPage(page));}
 @Post(':id/draft') draft(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.action(t,'draft',id,b);}
 @Post(':id/authorize') @Header('Cache-Control','no-store') authorize(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.action(t,'authorize',id,b);}
 @Post(':id/submit') submit(@Tenant() t:TenantContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.action(t,'submit',id,b);}
}
@Controller('admin/central-support') @PlatformScope()
export class CentralSupportPlatformController{
 constructor(private readonly service:CentralSupportService,private readonly threads:CentralSupportThreadService){}

 @RequirePermission([CASES,ASSIGNED]) @Get(':id/thread') @Header('Cache-Control','no-store') thread(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Query('page') page?:string){return this.threads.read({o:null,a:r.authenticatedUser.userId,p:true},id,supportPage(page));}
 @RequirePermission([CASES,ASSIGNED]) @Post(':id/thread') replyThread(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.threads.write({o:null,a:r.authenticatedUser.userId,p:true},id,b);}
 @RequirePermission([CASES,ASSIGNED]) @Post(':id/attachments') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5242880,files:1,fields:0}})) upload(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@UploadedFile() f:DocumentFile){return this.threads.upload({o:null,a:r.authenticatedUser.userId,p:true},id,f);}
 @RequirePermission([CASES,ASSIGNED]) @Get(':id/attachments/:fileId') @Header('Cache-Control','no-store') download(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Param('fileId',new ParseUUIDPipe()) fileId:string){return this.threads.download({o:null,a:r.authenticatedUser.userId,p:true},id,fileId);}
 @Get() @RequirePermission([CASES,ASSIGNED]) list(@Req() r:RequestWithAuthenticatedUser,@Query('page') page?:string){return this.service.platform(r.authenticatedUser.userId,'list',null,{page:supportPage(page)});}
 @Get('policy/:id') @RequirePermission(['af285642-16b0-405a-982c-58de1a10f987']) policyRead(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string){return this.service.platform(r.authenticatedUser.userId,'policy_read',id);}
 @Post('policy/:id') @RequirePermission(['af285642-16b0-405a-982c-58de1a10f987']) policy(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'policy',id,b);}
 @Post('activation') @RequirePermission(['af285642-16b0-405a-982c-58de1a10f987']) activate(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'activate',null,b);}
 @Post(':id/triage') @RequirePermission([CASES]) triage(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'triage',id,b);}
 @Post(':id/reply') @RequirePermission([CASES,ASSIGNED]) reply(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'reply',id,b);}
 @Post('communications/:id/retry') @RequirePermission([CASES]) retry(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.platform(r.authenticatedUser.userId,'retry_email',id,b);}
}
