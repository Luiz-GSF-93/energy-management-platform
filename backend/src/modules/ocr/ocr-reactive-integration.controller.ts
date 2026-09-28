import {Controller,Get,Post,Param,Req,Body} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrReactiveIntegrationService} from './ocr-reactive-integration.service';
@Controller('documents')
export class OcrReactiveIntegrationController {
 constructor(private service:OcrReactiveIntegrationService){}
 @Get(':id/ocr/reactive-integration') @RequirePermission([P.DOCUMENTS_VIEW])
 preview(@Param('id') id:string,@Req() req:any){return this.service.preview(id,req.tenantContext);}
 @Post(':id/ocr/reactive-integration') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE])
 create(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.service.create(id,req.tenantContext,body);}
}
