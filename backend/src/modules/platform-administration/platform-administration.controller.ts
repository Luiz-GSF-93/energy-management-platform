import {Controller,Get,Header,Param,ParseUUIDPipe,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {TEAM_MANAGE,PLATFORM_COSTS_VIEW} from '../platform-team/platform-team.permissions';
import {PREPARE,CONFIRM,CASES,ASSIGNED} from '../platform-workflows/platform-workflows.service';
import {PLAN_VIEW} from '../plans/plans.service';
import {PlatformAdministrationService} from './platform-administration.service';
@Controller('admin/platform-administration') @PlatformScope()
export class PlatformAdministrationController{
 constructor(private readonly service:PlatformAdministrationService){}
 @Get('team') @RequirePermission([TEAM_MANAGE]) @Header('Cache-Control','no-store') team(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,'team',q);}
 @Get('audit') @RequirePermission([TEAM_MANAGE]) @Header('Cache-Control','no-store') audit(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,'audit',q);}
 @Get('support') @RequirePermission([CASES,ASSIGNED]) @Header('Cache-Control','no-store') support(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,'support',q);}
 @Get('support/:id') @RequirePermission([CASES,ASSIGNED]) @Header('Cache-Control','no-store') supportDetail(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string){return this.service.read(r.authenticatedUser.userId,'support',{},id);}
 @Get('support/:id/history') @RequirePermission([CASES,ASSIGNED]) @Header('Cache-Control','no-store') supportHistory(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,'support_history',q,id);}
 @Get('finance') @RequirePermission([PREPARE,CONFIRM]) @Header('Cache-Control','no-store') finance(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,'finance',q);}
 @Get('finance/:id') @RequirePermission([PREPARE,CONFIRM]) @Header('Cache-Control','no-store') financeDetail(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string){return this.service.read(r.authenticatedUser.userId,'finance',{},id);}
 @Get('finance/:id/history') @RequirePermission([PREPARE,CONFIRM]) @Header('Cache-Control','no-store') financeHistory(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,'finance_history',q,id);}
 @Get('sales-finance/:id') @RequirePermission([TEAM_MANAGE,'c767190a-5ec0-4d89-8675-688415e967b1']) @Header('Cache-Control','no-store') salesDetail(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string){return this.service.read(r.authenticatedUser.userId,'sales_detail',{},id);}
 @Get('sales-finance/:id/history') @RequirePermission([TEAM_MANAGE,'c767190a-5ec0-4d89-8675-688415e967b1']) @Header('Cache-Control','no-store') salesHistory(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,'sales_history',q,id);}
 @Get('sales-consolidated/:id') @RequirePermission([TEAM_MANAGE,'c767190a-5ec0-4d89-8675-688415e967b1']) @Header('Cache-Control','no-store') salesConsolidated(@Req() r:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string){return this.service.read(r.authenticatedUser.userId,'sales_consolidated_detail',{},id);}
 @Get('costs') @RequirePermission([PLAN_VIEW,PLATFORM_COSTS_VIEW]) @Header('Cache-Control','no-store') costs(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,'costs',q);}
}
