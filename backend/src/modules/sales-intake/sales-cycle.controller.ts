import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
import {SalesCycleService} from './sales-cycle.service';
@Controller('admin/sales/cycles-sandbox') @PlatformScope()
export class SalesCycleController {
 constructor(private readonly service:SalesCycleService){}
 @Get() @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,undefined,q);}
 @Get(':agreementId') @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('agreementId') id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,id,q);}
 @Post(':agreementId/check') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') check(@Req() r:RequestWithAuthenticatedUser,@Param('agreementId') id:string,@Body() b:unknown){return this.service.check(r.authenticatedUser.userId,id,b);}
}
