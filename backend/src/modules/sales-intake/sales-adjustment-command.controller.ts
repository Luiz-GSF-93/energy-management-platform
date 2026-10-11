import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
import {SalesAdjustmentCommandService} from './sales-adjustment-command.service';
@Controller('admin/sales/adjustment-commands-sandbox') @PlatformScope()
export class SalesAdjustmentCommandController {
 constructor(private readonly service:SalesAdjustmentCommandService){}
 @Get(':id') @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,id,q);}
 @Post(':id/prepare') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,id,b);}
 @Post(':id/authorize') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') authorize(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.transition(r.authenticatedUser.userId,id,'authorize',b);}
 @Post(':id/withdraw') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') withdraw(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.transition(r.authenticatedUser.userId,id,'withdraw',b);}
 @Post(':id/execute') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') execute(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.execute(r.authenticatedUser.userId,id,b);}
 @Post(':id/recover') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') recover(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.recover(r.authenticatedUser.userId,id,b);}
}
