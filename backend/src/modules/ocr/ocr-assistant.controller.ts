import {OcrAssistantProgressService} from './ocr-assistant-progress.service';
import {Body,Controller,Get,Param,Post,Req} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrAssistantService} from './ocr-assistant.service';
@Controller('documents')
export class OcrAssistantController {
 constructor(private service:OcrAssistantService,private progress:OcrAssistantProgressService){}
 @Post(':id/ocr/assistant/prepare') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 start(@Param('id') id:string,@Req() req:any){return this.progress.start(id,req.tenantContext);}
 @Get(':id/ocr/assistant/prepare/:job') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 status(@Param('id') id:string,@Param('job') job:string,@Req() req:any){return this.progress.status(id,job,req.tenantContext);}
 @Post(':id/ocr/assistant/validate') @RequirePermission([P.ENERGIA_OCR_PROCESS])
 validate(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.service.validate(id,req.tenantContext,body);}
 @Get(':id/ocr/assistant') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 inspect(@Param('id') id:string,@Req() req:any){return this.service.inspect(id,req.tenantContext);}
 @Post(':id/ocr/assistant') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE])
 apply(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.service.apply(id,req.tenantContext,body);}
}
