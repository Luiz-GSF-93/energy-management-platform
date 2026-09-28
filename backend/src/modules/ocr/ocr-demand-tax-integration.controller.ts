import {Controller,Get,Post,Param,Req,Body} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrDemandTaxIntegrationService} from './ocr-demand-tax-integration.service';
@Controller('documents')
export class OcrDemandTaxIntegrationController{
 constructor(private service:OcrDemandTaxIntegrationService){}
 @Get(':id/ocr/demand-tax-integration') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) preview(@Param('id') id:string,@Req() r:any){return this.service.preview(id,r.tenantContext);}
 @Post(':id/ocr/demand-tax-integration') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE,P.ORGANIZATION_CONTRACTS_UPDATE]) create(@Param('id') id:string,@Req() r:any,@Body() body:unknown){return this.service.create(id,r.tenantContext,body);}
}
