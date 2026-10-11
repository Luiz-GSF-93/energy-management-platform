import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
import {SalesEvidenceService} from './sales-evidence.service';
@Controller('admin/sales/evidence-sandbox') @PlatformScope()
export class SalesEvidenceController {
 constructor(private readonly service:SalesEvidenceService){}
 @Get(':kind/:id') @RequirePermission([SALES_OWNER,SALES_FINANCE_READ]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('kind') kind:string,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.read(r.authenticatedUser.userId,kind,id,q);}
 @Post(':kind/:id/check') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') check(@Req() r:RequestWithAuthenticatedUser,@Param('kind') kind:string,@Param('id') id:string,@Body() b:unknown){return this.service.check(r.authenticatedUser.userId,kind,id,b);}
}
