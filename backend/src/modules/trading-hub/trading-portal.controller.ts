import {Body,Controller,Get,Header,Headers,Param,Post,Res,UploadedFile,UseInterceptors} from '@nestjs/common';


import {FileInterceptor} from '@nestjs/platform-express';


import {Public} from '../../common/decorators/public.decorator';


import {Tenant} from '../../common/decorators/tenant.decorator';


import {TenantContext} from '../../common/interfaces/tenant-context.interface';


import {TradingPortalService} from './trading-portal.service';


@Controller('trading-hub')


export class TradingInvitationsController {


 constructor(private service:TradingPortalService){}


 @Get('files/:id') file(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.backofficeFile(id,t);}


 @Get('invitations') list(@Tenant() t:TenantContext){return this.service.invitations(t);}


 @Post('invitations/:id/revoke') revoke(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.revoke(id,t);}


 @Post('opportunities/:id/dispatch') dispatch(@Param('id') id:string,@Body() b:unknown,@Tenant() t:TenantContext){return this.service.dispatch(id,b,t);}


 @Post('proposals/:id/contract') contract(@Param('id') id:string,@Body() b:unknown,@Tenant() t:TenantContext){return this.service.hubContract(id,b,t);}
 @Post('proposals/:id/client-invite') client(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.inviteClient(id,t);}


}


@Controller('trading-portal')


export class TradingPortalController {


 constructor(private service:TradingPortalService){}


 @Public() @Header('Cache-Control','no-store') @Post('challenge') challenge(@Headers('x-trading-token') token:string){return this.service.challenge(token);}


 @Public() @Header('Cache-Control','no-store') @Post('verify') verify(@Headers('x-trading-token') token:string,@Body() b:unknown){return this.service.verify(token,b);}


 @Public() @Header('Cache-Control','no-store') @Get() view(@Headers('x-trading-session') session:string,@Res({passthrough:true}) res:any){res.set('Cache-Control','no-store');return this.service.view(session);}


 @Public() @Header('Cache-Control','no-store') @Post('reply') reply(@Headers('x-trading-session') session:string,@Body() b:unknown){return this.service.reply(session,b);}


 @Public() @Header('Cache-Control','no-store') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10485760,files:1}})) @Post('files') upload(@Headers('x-trading-session') session:string,@UploadedFile() file:any){return this.service.upload(session,file);}


 @Public() @Header('Cache-Control','no-store') @Get('documents/:id') download(@Headers('x-trading-session') session:string,@Param('id') id:string){return this.service.download(session,id);}


}


