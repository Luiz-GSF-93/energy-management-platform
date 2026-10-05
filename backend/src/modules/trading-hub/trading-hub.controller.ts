import {Body,Controller,Get,Param,Post,Put} from '@nestjs/common';

import {Tenant} from '../../common/decorators/tenant.decorator';

import {TenantContext} from '../../common/interfaces/tenant-context.interface';

import {TradingHubService} from './trading-hub.service';

@Controller('trading-hub')

export class TradingHubController {

 constructor(private service:TradingHubService){}

 @Get() list(@Tenant() t:TenantContext){return this.service.list(t);}

 @Get('documents') documents(@Tenant() t:TenantContext){return this.service.documents(t);}
 @Get(':id/history') history(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.history(id,t);}

 @Post(':kind') create(@Param('kind') kind:string,@Body() body:unknown,@Tenant() t:TenantContext){return this.service.save(kind,null,body,t);}

 @Put(':kind/:id') save(@Param('kind') kind:string,@Param('id') id:string,@Body() body:unknown,@Tenant() t:TenantContext){return this.service.save(kind,id,body,t);}

 @Post('records/:id/transition') transition(@Param('id') id:string,@Body() body:unknown,@Tenant() t:TenantContext){return this.service.transition(id,body,t);}

}

