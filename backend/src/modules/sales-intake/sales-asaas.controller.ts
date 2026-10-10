import {Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req} from '@nestjs/common';
import {Public} from '../../common/decorators/public.decorator';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesAsaasService} from './sales-asaas.service';
const owner=['82e7fc71-479a-4dd6-8b22-4fba6eaa6841'];
@Controller('admin/sales/asaas') @PlatformScope()
export class SalesAsaasController {
 constructor(private readonly service:SalesAsaasService){}
 @Get() @RequirePermission(owner) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission(owner) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.read(r.authenticatedUser.userId,id);}
 @Post('bindings') @RequirePermission(owner) @Header('Cache-Control','no-store') bind(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.bind(r.authenticatedUser.userId,b);}
 @Post(':id/verify') @RequirePermission(owner) @Header('Cache-Control','no-store') verify(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.verify(r.authenticatedUser.userId,id);}
}
@Controller('public/sales/asaas-sandbox')
export class SalesAsaasWebhookController {
 constructor(private readonly service:SalesAsaasService){}
 @Post('webhook') @Public() @HttpCode(200) @Header('Cache-Control','no-store') webhook(@Headers('asaas-access-token') token:string|undefined,@Body() body:unknown){return this.service.webhook(token,body);}
}
