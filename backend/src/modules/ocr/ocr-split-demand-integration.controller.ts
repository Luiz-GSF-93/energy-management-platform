import {Controller,Get,Post,Param,Req,Body} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrSplitDemandIntegrationService} from './ocr-split-demand-integration.service';
@Controller('documents')
export class OcrSplitDemandIntegrationController {
 constructor(private service:OcrSplitDemandIntegrationService){}
 @Get(':id/ocr/split-demand-integration') @RequirePermission([P.DOCUMENTS_VIEW])
 preview(@Param('id') id:string,@Req() req:any){return this.service.preview(id,req.tenantContext);}
 @Post(':id/ocr/split-demand-integration') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE])
 create(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.service.create(id,req.tenantContext,body);}
}
