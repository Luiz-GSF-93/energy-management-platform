import {BadRequestException,Body,Controller,Get,Header,Param,Post,Query,Req,StreamableFile} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesCommercialService} from './sales-commercial.service';
import {offerDocumentModel} from './sales-offer-document';
import {proposalDocumentModel,renderProposalPdf} from './sales-proposal-document';
@Controller('admin/sales/commercial') @PlatformScope()
export class SalesCommercialController{
 constructor(private readonly sales:SalesCommercialService){}
 @Get() @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 read(@Req() req:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){if(Object.keys(q).some(k=>k!=='receipt')||q.receipt!==undefined&&typeof q.receipt!=='string')throw new BadRequestException('Filtros inválidos.');return this.sales.read(req.authenticatedUser.userId,q.receipt as string|undefined);}
 @Get('proposals/:id/preview') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 async preview(@Req() req:RequestWithAuthenticatedUser,@Param('id') id:string){return proposalDocumentModel(await this.sales.approvedProposal(req.authenticatedUser.userId,id));}
 @Get('proposals/:id/pdf') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store') @Header('X-Content-Type-Options','nosniff')
 async pdf(@Req() req:RequestWithAuthenticatedUser,@Param('id') id:string){const model=proposalDocumentModel(await this.sales.approvedProposal(req.authenticatedUser.userId,id));return new StreamableFile(await renderProposalPdf(model),{type:'application/pdf',disposition:`attachment; filename="energyos-proposta-${id}.pdf"`});}
 @Get('proposals/:id/conditions/:revision/preview') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 async offerPreview(@Req() req:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('revision') revision:string){return offerDocumentModel(await this.sales.offerDocument(req.authenticatedUser.userId,id,revision));}
 @Get('proposals/:id/conditions/:revision/pdf') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store') @Header('X-Content-Type-Options','nosniff')
 async offerPdf(@Req() req:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('revision') revision:string){const model=offerDocumentModel(await this.sales.offerDocument(req.authenticatedUser.userId,id,revision));return new StreamableFile(await renderProposalPdf(model),{type:'application/pdf',disposition:`attachment; filename="energyos-condicoes-${id}-r${Number(revision)}.pdf"`});}
 @Get('proposals/:id/terms') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 terms(@Req() req:RequestWithAuthenticatedUser,@Param('id') id:string){return this.sales.offerTerms(req.authenticatedUser.userId,id);}
 @Post('offer-terms') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 saveTerms(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.sales.saveOfferTerms(req.authenticatedUser.userId,body);}
 @Post('offer-term-reviews') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 reviewTerms(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.sales.reviewOfferTerms(req.authenticatedUser.userId,body);}
 @Post('policies') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 policy(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.sales.policy(req.authenticatedUser.userId,body);}
 @Post('proposals') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 proposal(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.sales.proposal(req.authenticatedUser.userId,body);}
 @Post('reviews') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 review(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.sales.review(req.authenticatedUser.userId,body);}
}
