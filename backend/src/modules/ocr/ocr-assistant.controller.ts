import {Body,Controller,Get,Param,Post,Req} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrAssistantService} from './ocr-assistant.service';
@Controller('documents')
export class OcrAssistantController {
 constructor(private service:OcrAssistantService){}
 @Get(':id/ocr/assistant') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 inspect(@Param('id') id:string,@Req() req:any){return this.service.inspect(id,req.tenantContext);}
 @Post(':id/ocr/assistant') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE])
 apply(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.service.apply(id,req.tenantContext,body);}
}
