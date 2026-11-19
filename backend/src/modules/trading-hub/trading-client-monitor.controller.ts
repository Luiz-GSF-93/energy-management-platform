import {Body,Controller,Get,Header,Headers,Param,Post,Query} from '@nestjs/common';
import {Public} from '../../common/decorators/public.decorator';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {TradingClientMonitorService} from './trading-client-monitor.service';
@Controller('trading-hub/client-monitor')
export class TradingClientMonitorController{
 constructor(private service:TradingClientMonitorService){}
 @Get(':id') list(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.office(id,t,'LIST');}
 @Get(':id/preview') @Header('Cache-Control','no-store') preview(@Param('id') id:string,@Tenant() t:TenantContext,@Query() q:Record<string,string>){return this.service.office(id,t,'PREVIEW',q);}
 @Post(':id/invite') invite(@Param('id') id:string,@Body() b:unknown,@Tenant() t:TenantContext){return this.service.office(id,t,'ISSUE',b);}
 @Post(':id/revoke') revoke(@Param('id') id:string,@Body() b:unknown,@Tenant() t:TenantContext){return this.service.office(id,t,'REVOKE',b);}
}
@Controller('trading-client-monitor')
export class TradingClientMonitorPublicController{
 constructor(private service:TradingClientMonitorService){}
 @Public() @Get() @Header('Cache-Control','no-store') view(@Headers('x-trading-session') s:string,@Query() q:Record<string,string>){return this.service.view(s,q);}
 @Public() @Post('challenge') @Header('Cache-Control','no-store') challenge(@Headers('x-trading-token') t:string){return this.service.challenge(t);}
 @Public() @Post('verify') @Header('Cache-Control','no-store') verify(@Headers('x-trading-token') t:string,@Body() b:unknown){return this.service.verify(t,b);}
}
