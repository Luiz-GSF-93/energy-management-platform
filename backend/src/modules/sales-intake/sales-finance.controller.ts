import {Controller,Get,Header,Param,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesFinanceService,SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
@Controller('admin/sales/finance-sandbox') @PlatformScope()
export class SalesFinanceController {
 constructor(private readonly service:SalesFinanceService){}
 @Get() @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') detail(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.read(r.authenticatedUser.userId,{},id);}
}
