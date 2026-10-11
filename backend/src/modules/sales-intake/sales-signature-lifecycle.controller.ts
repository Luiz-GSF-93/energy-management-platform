import {Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,RawBodyRequest,Req,Res} from '@nestjs/common';
import {Request,Response} from 'express';
import {Public} from '../../common/decorators/public.decorator';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_OWNER} from './sales-finance.service';
import {SalesSignatureLifecycleService} from './sales-signature-lifecycle.service';
@Controller('admin/sales/signatures') @PlatformScope() @RequirePermission([SALES_OWNER])
export class SalesSignatureLifecycleController{
 constructor(private readonly service:SalesSignatureLifecycleService){}
 @Get(':id/lifecycle') @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,id,q);}
 @Post('lifecycle/check') @Header('Cache-Control','no-store') check(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.check(r.authenticatedUser.userId,b);}
 @Post('lifecycle/commands') @Header('Cache-Control','no-store') command(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,b);}
 @Post('lifecycle/reconcile') @Header('Cache-Control','no-store') reconcile(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.reconcile(r.authenticatedUser.userId,b);}
 @Post('lifecycle/resolve') @Header('Cache-Control','no-store') resolve(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.resolve(r.authenticatedUser.userId,b);}
 @Post('lifecycle/bridge') @Header('Cache-Control','no-store') bridge(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.bridge(r.authenticatedUser.userId,b);}
 @Post('lifecycle/reviews') @Header('Cache-Control','no-store') review(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.review(r.authenticatedUser.userId,b);}
 @Get(':id/lifecycle/artifacts/:checkId/pdf') async pdf(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('checkId') checkId:string,@Res() res:Response){const bytes=await this.service.artifact(r.authenticatedUser.userId,id,checkId,'PDF');res.set({'Cache-Control':'private, no-store','Content-Type':'application/pdf','Content-Disposition':'attachment; filename="energyos-clicksign-sandbox-assinado.pdf"','X-Content-Type-Options':'nosniff'});res.send(bytes);}
 @Get(':id/lifecycle/artifacts/:checkId/log') async log(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('checkId') checkId:string,@Res() res:Response){const bytes=await this.service.artifact(r.authenticatedUser.userId,id,checkId,'LOG');res.set({'Cache-Control':'private, no-store','Content-Type':'application/json','Content-Disposition':'attachment; filename="energyos-clicksign-sandbox-eventos.json"','X-Content-Type-Options':'nosniff'});res.send(bytes);}
}
@Controller('public/sales/clicksign-sandbox')
export class SalesSignatureWebhookController{
 constructor(private readonly service:SalesSignatureLifecycleService){}
 @Post('webhook') @Public() @HttpCode(200) @Header('Cache-Control','no-store') receive(@Req() req:RawBodyRequest<Request>,@Headers('content-hmac') header:unknown){return this.service.webhook(req.rawBody,header);}
}
