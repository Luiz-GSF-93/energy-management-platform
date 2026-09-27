import {Controller,Get,Post,Param,Req,Body} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrCdeTaxIntegrationService} from './ocr-cde-tax-integration.service';
@Controller('documents')
export class OcrCdeTaxIntegrationController {
 constructor(private service:OcrCdeTaxIntegrationService){}
 @Get(':id/ocr/cde-tax-integration') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) preview(@Param('id') id:string,@Req() r:any){return this.service.preview(id,r.tenantContext);}
 @Post(':id/ocr/cde-tax-integration/revision') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE,P.ORGANIZATION_CONTRACTS_UPDATE]) revision(@Param('id') id:string,@Req() r:any,@Body() body:unknown){return this.service.createRevision(id,r.tenantContext,body);}
 @Post(':id/ocr/cde-tax-integration') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) update(@Param('id') id:string,@Req() r:any,@Body() body:unknown){return this.service.update(id,r.tenantContext,body);}
}
