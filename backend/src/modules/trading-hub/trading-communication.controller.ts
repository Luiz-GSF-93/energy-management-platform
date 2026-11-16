import {Body,Controller,Get,Header,Headers,Param,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {Public} from '../../common/decorators/public.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {TradingCommunicationService} from './trading-communication.service';

@Controller('trading-hub/communications')
export class TradingCommunicationController{
 constructor(private service:TradingCommunicationService){}
 @Get('tasks') @Header('Cache-Control','no-store') tasks(@Tenant() t:TenantContext){return this.service.tasks(t);}
 @Get() @Header('Cache-Control','no-store') inbox(@Tenant() t:TenantContext,@Query('page') page='0'){return this.service.inbox(t,Number(page));}
 @Post('messages') message(@Tenant() t:TenantContext,@Body() b:unknown){return this.service.message(t,b);}
 @Get('proposals/:id/thanks') @Header('Cache-Control','no-store') preview(@Tenant() t:TenantContext,@Param('id') id:string){return this.service.preview(t,id);}
 @Post('proposals/:id/thanks') thanks(@Tenant() t:TenantContext,@Param('id') id:string,@Body() b:unknown){return this.service.thanks(t,id,b);}
}
@Controller('trading-quote-conversations')
export class TradingQuoteConversationController{
 constructor(private service:TradingCommunicationService){}
 @Public() @Post('challenge') @Header('Cache-Control','no-store') challenge(@Headers('x-trading-token') token:string){return this.service.challenge(token);}
 @Public() @Post('verify') @Header('Cache-Control','no-store') verify(@Headers('x-trading-token') token:string,@Body() b:unknown){return this.service.verify(token,b);}
 @Public() @Get() @Header('Cache-Control','no-store') view(@Headers('x-trading-session') session:string){return this.service.supplierView(session);}
 @Public() @Post('messages') @Header('Cache-Control','no-store') message(@Headers('x-trading-session') session:string,@Body() b:unknown){return this.service.supplierMessage(session,b);}
}
