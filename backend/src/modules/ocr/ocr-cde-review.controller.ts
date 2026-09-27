import {Controller,Get,Post,Param,Body,Req} from '@nestjs/common';
import {OrganizationId} from '../../common/decorators/tenant.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrCdeReviewService} from './ocr-cde-review.service';
@Controller('documents')
export class OcrCdeReviewController{
 constructor(private reviews:OcrCdeReviewService){}
 @Get(':id/ocr/cde-reviews') @RequirePermission([P.DOCUMENTS_VIEW])
 async list(@Param('id') id:string,@OrganizationId() org:string,@Req() req:any){return {...await this.reviews.list(org,id),canReview:this.reviews.canReview(org,req.tenantContext)&&req.tenantContext.permissions?.includes(P.ENERGIA_OCR_PROCESS)};}
 @Post(':id/ocr/cde-reviews') @RequirePermission([P.ENERGIA_OCR_PROCESS])
 create(@Param('id') id:string,@OrganizationId() org:string,@Req() req:any,@Body() body:unknown){return this.reviews.create(org,id,req.tenantContext,body);}
}
