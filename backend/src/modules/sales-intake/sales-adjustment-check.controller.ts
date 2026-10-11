import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
import {SalesAdjustmentCheckService} from './sales-adjustment-check.service';
@Controller('admin/sales/adjustment-checks-sandbox') @PlatformScope()
export class SalesAdjustmentCheckController {
 constructor(private readonly service:SalesAdjustmentCheckService){}
 @Get(':id') @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,id,q);}
 @Post(':id/prepare') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,id,b);}
 @Post(':id/check') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') check(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.check(r.authenticatedUser.userId,id,b);}
}
