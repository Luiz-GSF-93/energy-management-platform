import {OcrAssistantProgressService} from './ocr-assistant-progress.service';
import {Body,Controller,Get,Param,Post,Req} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrAssistantService} from './ocr-assistant.service';
import {OcrAutofillService} from './ocr-autofill.service';
import {OcrResolutionService} from './ocr-resolution.service';
@Controller('documents')
export class OcrAssistantController {
 constructor(private service:OcrAssistantService,private progress:OcrAssistantProgressService,private autofill:OcrAutofillService,private resolution:OcrResolutionService){}
 @Get(':id/ocr/assistant/resolution') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 resolutionPlan(@Param('id') id:string,@Req() req:any){return this.resolution.inspect(id,req.tenantContext);}
 @Post(':id/ocr/assistant/resolution/prepare') @RequirePermission([P.ENERGIA_OCR_PROCESS])
 resolutionPrepare(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.resolution.prepare(id,req.tenantContext,body);}
 @Post(':id/ocr/assistant/resolution/repair') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE])
 resolutionRepair(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.resolution.repair(id,req.tenantContext,body);}
 @Post(':id/ocr/assistant/resolution/approve') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE])
 resolutionApprove(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.resolution.approve(id,req.tenantContext,body);}
 @Get(':id/ocr/assistant/autofill') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 filled(@Param('id') id:string,@Req() req:any){return this.autofill.inspect(id,req.tenantContext);}
 @Post(':id/ocr/assistant/autofill/library') @RequirePermission([P.ENERGIA_OCR_PROCESS])
 library(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.autofill.applyLibrary(id,req.tenantContext,body);}
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
