import {Body,Controller,Get,Header,Headers,Param,Post,Query,Res,UploadedFiles,UseInterceptors} from '@nestjs/common';
import {FilesInterceptor} from '@nestjs/platform-express';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {Public} from '../../common/decorators/public.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {TradingWorkflowService} from './trading-workflow.service';
import {TradingUploadLimit} from './trading-upload-limit';
const limits={fileSize:20971520,files:20,fields:1,parts:21};
function fileResponse(res:any,f:any){res.set({'Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Content-Type':f.mime,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(f.name)});res.send(f.bytes);}
@Controller('trading-approvals')
export class TradingWorkflowController{
 constructor(private s:TradingWorkflowService){}
 @Get('tasks') tasks(@Tenant() t:TenantContext){return this.s.tasks(t);}
 @Get() list(@Tenant() t:TenantContext,@Query('page') p='0',@Query('proposal') id?:string){return this.s.read(t,false,Number(p),id);}
 @Post(':id/action') action(@Tenant() t:TenantContext,@Param('id') id:string,@Body() b:unknown){return this.s.act(t,id,b);}
 @Post(':id/files') @UseInterceptors(TradingUploadLimit,FilesInterceptor('files',20,{limits})) upload(@Tenant() t:TenantContext,@Param('id') id:string,@UploadedFiles() f:any[],@Body('batchId') batch:string){return this.s.upload(t,id,null,f,batch);}
 @Post(':id/share') share(@Tenant() t:TenantContext,@Param('id') id:string,@Body() b:unknown){return this.s.files(t,id,null,'SHARE',null,b);}
 @Get(':id/files/:file') async download(@Tenant() t:TenantContext,@Param('id') id:string,@Param('file') f:string,@Res() res:any){fileResponse(res,await this.s.download(t,id,null,f));}
}
@Controller('portal/trading-approvals')
export class TradingClientApprovalController{
 constructor(private s:TradingWorkflowService){}
 @Get('tasks') tasks(@Tenant() t:TenantContext){return this.s.tasks(t,true);}
 @Get() list(@Tenant() t:TenantContext,@Query('page') p='0'){return this.s.read(t,true,Number(p));}
 @Post(':id/action') action(@Tenant() t:TenantContext,@Param('id') id:string,@Body() b:unknown){return this.s.act(t,id,b,true);}
}
@Controller('trading-formalization')
export class TradingFormalizationController{
 constructor(private s:TradingWorkflowService){}
 @Public() @Post('challenge') @Header('Cache-Control','no-store') challenge(@Headers('x-trading-token') token:string){return this.s.challenge(token);}
 @Public() @Post('verify') @Header('Cache-Control','no-store') verify(@Headers('x-trading-token') token:string,@Body() b:unknown){return this.s.verify(token,b);}
 @Public() @Get() @Header('Cache-Control','no-store') view(@Headers('x-trading-session') session:string){return this.s.supplierView(session);}
 @Public() @Post('accept') @Header('Cache-Control','no-store') accept(@Headers('x-trading-session') session:string,@Body() b:unknown){return this.s.supplierAccept(session,b);}
 @Public() @Post('files') @UseInterceptors(TradingUploadLimit,FilesInterceptor('files',20,{limits})) @Header('Cache-Control','no-store') upload(@Headers('x-trading-session') session:string,@UploadedFiles() f:any[],@Body('batchId') batch:string){return this.s.upload(null,null,session,f,batch);}
 @Public() @Get('files/:id') async download(@Headers('x-trading-session') session:string,@Param('id') id:string,@Res() res:any){fileResponse(res,await this.s.download(null,null,session,id));}
}
