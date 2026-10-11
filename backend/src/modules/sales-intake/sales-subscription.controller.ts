import {Body,Controller,Get,Header,Param,Post,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
import {SalesSubscriptionService} from './sales-subscription.service';
@Controller('admin/sales/recurrence-sandbox/:agreementId/command') @PlatformScope()
export class SalesSubscriptionController {
 constructor(private readonly service:SalesSubscriptionService){}
 @Get() @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('agreementId') id:string){return this.service.read(r.authenticatedUser.userId,id);}
 @Post() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Param('agreementId') id:string,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,id,b);}
 @Post('execute') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') execute(@Req() r:RequestWithAuthenticatedUser,@Param('agreementId') id:string,@Body() b:unknown){return this.service.execute(r.authenticatedUser.userId,id,b);}
 @Post('reconcile') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') reconcile(@Req() r:RequestWithAuthenticatedUser,@Param('agreementId') id:string,@Body() b:unknown){return this.service.reconcile(r.authenticatedUser.userId,id,b);}
}
