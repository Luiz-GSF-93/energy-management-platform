import {Controller,Get,Post,Param,Req,Body} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrTusdIntegrationService} from './ocr-tusd-integration.service';
@Controller('documents')
export class OcrTusdIntegrationController{
 constructor(private service:OcrTusdIntegrationService){}
 @Get(':id/ocr/tusd-integration') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) preview(@Param('id') id:string,@Req() r:any){return this.service.preview(id,r.tenantContext);}
 @Post(':id/ocr/tusd-integration') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) create(@Param('id') id:string,@Req() r:any,@Body() body:unknown){return this.service.create(id,r.tenantContext,body);}
}
