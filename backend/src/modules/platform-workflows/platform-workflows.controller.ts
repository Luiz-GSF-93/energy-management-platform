import {BadRequestException,Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {DocumentFile} from '../documents/services/document-file';
import {ASSIGNED,CASES,CONFIRM,PlatformWorkflowsService,PREPARE} from './platform-workflows.service';
const actor=(r:RequestWithAuthenticatedUser)=>({userId:r.authenticatedUser.userId,ip:r.ip,agent:r.get('user-agent')});
export function workflowQuery(q:Record<string,unknown>){
 if(Object.entries(q).some(([k,v])=>!['page','id','status','organization','month'].includes(k)||typeof v!=='string'||v.length>150)||q.page!==undefined&&!/^\d{1,4}$/.test(String(q.page))||Number(q.page??0)>1000||q.id!==undefined&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(q.id)))throw new BadRequestException('Filtros inválidos.');
 const filter:Record<string,string>={};for(const k of ['status','organization','month'])if(q[k])filter[k]=String(q[k]);return {page:Number(q.page??0),id:q.id as string|undefined,filter};
}
@Controller('admin/platform-workflows') @PlatformScope()
export class PlatformWorkflowsController{
 constructor(private readonly service:PlatformWorkflowsService){}
 @Get('finance') @RequirePermission([PREPARE,CONFIRM]) finance(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){const f=workflowQuery(q);return this.service.read(actor(r),'finance',f.page,f.id,f.filter);}
 @Get('support') @RequirePermission([CASES,ASSIGNED]) support(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){const f=workflowQuery(q);return this.service.read(actor(r),'support',f.page,f.id,f.filter);}
 @Post('finance/:id') @RequirePermission([PREPARE,CONFIRM]) saveFinance(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:unknown){return this.service.save(actor(r),'finance',id,body);}
 @Post('support/:id') @RequirePermission([CASES,ASSIGNED]) saveSupport(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:unknown){return this.service.save(actor(r),'support',id,body);}
 @Post('evidence') @RequirePermission([PREPARE]) @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10485760,files:1,fields:0}})) upload(@Req() r:RequestWithAuthenticatedUser,@UploadedFile() file?:DocumentFile){return this.service.upload(actor(r),file);}
 @Get('evidence/:id') @RequirePermission([PREPARE]) download(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string){return this.service.download(actor(r),id);}
}
