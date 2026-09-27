import {Controller,Get,Post,Param,Query,Body,Req} from '@nestjs/common';
import {OrganizationId,UserId} from '../../common/decorators/tenant.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../common/constants/permissions';
import {OcrDemandReviewService} from './ocr-demand-review.service';
import {OcrReviewService} from './ocr-review.service';
import {OcrQueueService} from './ocr-queue.service';
@Controller('documents')
export class OcrController {
 constructor(private readonly queue:OcrQueueService,private readonly reviews:OcrReviewService,private readonly demandReviews:OcrDemandReviewService){}
 @Get(':id/ocr/demand-reviews')
 @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
 async demandReviewList(@Param('id') id:string,@OrganizationId() org:string,@Req() req:any){return {...await this.demandReviews.list(org,id),canReview:this.demandReviews.canReview(org,req.tenantContext)};}
 @Post(':id/ocr/demand-reviews')
 @RequirePermission([PERMISSIONS.ENERGIA_OCR_PROCESS])
 demandReviewCreate(@Param('id') id:string,@OrganizationId() org:string,@Req() req:any,@Body() body:unknown){return this.demandReviews.create(org,id,req.tenantContext,body);}
 @Get(':id/ocr/reviews')
 @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
 reviewList(@Param('id') id:string,@OrganizationId() org:string){return this.reviews.list(org,id);}
 @Post(':id/ocr/reviews')
 @RequirePermission([PERMISSIONS.ENERGIA_OCR_PROCESS])
 reviewCreate(@Param('id') id:string,@OrganizationId() org:string,@UserId() actor:string,@Body() body:unknown){return this.reviews.create(org,id,actor,body);}
 @Post(':id/ocr')
 @RequirePermission([PERMISSIONS.ENERGIA_OCR_PROCESS])
 enqueue(@Param('id') id:string,@OrganizationId() org:string,@UserId() actor:string){return this.queue.enqueue(org,id,actor);}
 @Get(':id/ocr/readout')
 @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
 readout(@Param('id') id:string,@OrganizationId() org:string,@Query() query:Record<string,unknown>){return this.queue.readout(org,id,query);}
 @Get(':id/ocr')
 @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
 status(@Param('id') id:string,@OrganizationId() org:string){return this.queue.status(org,id);}
}
