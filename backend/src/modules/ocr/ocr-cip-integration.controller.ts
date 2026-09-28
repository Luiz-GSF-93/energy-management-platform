import {Controller,Get,Post,Param,Req,Body} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrCipIntegrationService} from './ocr-cip-integration.service';
@Controller('documents')
export class OcrCipIntegrationController{
 constructor(private service:OcrCipIntegrationService){}
 @Get(':id/ocr/cip-integration') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) preview(@Param('id') id:string,@Req() r:any){return this.service.preview(id,r.tenantContext);}
 @Post(':id/ocr/cip-integration') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) create(@Param('id') id:string,@Req() r:any,@Body() body:unknown){return this.service.create(id,r.tenantContext,body);}
 @Post(':id/ocr/cip-integration/prepare-review') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) prepareReview(@Param('id') id:string,@Req() r:any,@Body() body:unknown){return this.service.prepareReview(id,r.tenantContext,body);}
}
