import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
import {SalesAdjustmentService} from './sales-adjustment.service';
@Controller('admin/sales/adjustments-sandbox') @PlatformScope()
export class SalesAdjustmentController {
 constructor(private readonly service:SalesAdjustmentService){}
 @Get() @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get('source/:origin/:id') @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') source(@Req() r:RequestWithAuthenticatedUser,@Param('origin') origin:string,@Param('id') id:string){return this.service.source(r.authenticatedUser.userId,origin,id);}
 @Get(':id') @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,id,q);}
 @Post() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,b);}
 @Post(':id/:action') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') transition(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('action') action:string,@Body() b:unknown){return this.service.transition(r.authenticatedUser.userId,id,action,b);}
}
