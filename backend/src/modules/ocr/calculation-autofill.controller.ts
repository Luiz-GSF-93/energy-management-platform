import {Body,Controller,Get,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {CalculationAutofillService} from './calculation-autofill.service';
@Controller('calculation-autofill')
export class CalculationAutofillController{
 constructor(private service:CalculationAutofillService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) inspect(@Query() q:Record<string,unknown>,@Tenant() t:TenantContext){return this.service.inspect(q,t);}
 @Get('history') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) history(@Query() q:Record<string,unknown>,@Tenant() t:TenantContext){return this.service.history(q,t);}
 @Post('preview') @RequirePermission([P.ENERGIA_OCR_PROCESS]) preview(@Body() b:unknown,@Tenant() t:TenantContext){return this.service.preview(b,t);}
 @Post('reconcile') @RequirePermission([P.ENERGIA_OCR_PROCESS]) reconcile(@Body() b:unknown,@Tenant() t:TenantContext){return this.service.reconcile(b,t);}
 @Post() @RequirePermission([P.ENERGIA_OCR_PROCESS]) prepare(@Body() b:unknown,@Tenant() t:TenantContext){return this.service.prepare(b,t);}
}
