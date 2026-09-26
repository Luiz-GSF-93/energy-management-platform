import {Controller,Get,Post,Param} from '@nestjs/common';
import {OrganizationId,UserId} from '../../common/decorators/tenant.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../common/constants/permissions';
import {OcrQueueService} from './ocr-queue.service';
@Controller('documents')
export class OcrController {
 constructor(private readonly queue:OcrQueueService){}
 @Post(':id/ocr')
 @RequirePermission([PERMISSIONS.ENERGIA_OCR_PROCESS])
 enqueue(@Param('id') id:string,@OrganizationId() org:string,@UserId() actor:string){return this.queue.enqueue(org,id,actor);}
 @Get(':id/ocr')
 @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
 status(@Param('id') id:string,@OrganizationId() org:string){return this.queue.status(org,id);}
}
