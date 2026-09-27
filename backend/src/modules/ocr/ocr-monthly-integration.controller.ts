import {Controller,Get,Post,Param,Req,Body} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrMonthlyIntegrationService} from './ocr-monthly-integration.service';
@Controller('documents')
export class OcrMonthlyIntegrationController {
 constructor(private service:OcrMonthlyIntegrationService){}
 @Get(':id/ocr/measurement-readiness') @RequirePermission([P.DOCUMENTS_VIEW])
 measurementReadiness(@Param('id') id:string,@Req() req:any){return this.service.measurementReadiness(id,req.tenantContext);}
 @Get(':id/ocr/monthly-integration') @RequirePermission([P.DOCUMENTS_VIEW])
 preview(@Param('id') id:string,@Req() req:any){return this.service.preview(id,req.tenantContext);}
 @Post(':id/ocr/monthly-integration') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE])
 create(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.service.create(id,req.tenantContext,body);}
}
