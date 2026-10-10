import {BadRequestException,Body,Controller,Get,Header,Headers,HttpCode,Post,Query,Req} from '@nestjs/common';
import {Request} from 'express';
import {Public} from '../../common/decorators/public.decorator';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesIntakeService} from './sales-intake.service';
import {salesRequesterIp} from './sales-intake.ingress';
@Controller('public/sales')
export class PublicSalesController{
 constructor(private readonly sales:SalesIntakeService){}
 @Post('leads') @Public() @HttpCode(201) @Header('Cache-Control','no-store')
 submit(@Body() body:unknown,@Headers('origin') origin:string|undefined,@Req() req:Request){return this.sales.submit(body,origin,process.env.SALES_INTAKE_ENABLED==='true'?salesRequesterIp(req):undefined);}
}
@Controller('admin/sales') @PlatformScope()
export class AdminSalesController{
 constructor(private readonly sales:SalesIntakeService){}
 @Get('leads') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 list(@Req() req:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){
  if(Object.entries(q).some(([k,v])=>!['page','search'].includes(k)||typeof v!=='string')||q.page!==undefined&&!/^\d{1,4}$/.test(String(q.page))||Number(q.page??0)>1000||String(q.search??'').length>120)throw new BadRequestException('Filtros inválidos.');
  return this.sales.list(req.authenticatedUser.userId,Number(q.page??0),String(q.search??'').trim());
 }
}
