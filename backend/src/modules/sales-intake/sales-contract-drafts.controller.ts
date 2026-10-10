import {Body,Controller,Get,Header,Param,Post,Query,Req,StreamableFile} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesContractDraftsService} from './sales-contract-drafts.service';
const owner=['82e7fc71-479a-4dd6-8b22-4fba6eaa6841'];
@Controller('admin/sales/contracts') @PlatformScope()
export class SalesContractDraftsController {
 constructor(private readonly drafts:SalesContractDraftsService){}
 @Get() @RequirePermission(owner) @Header('Cache-Control','no-store')
 list(@Req() req:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.drafts.list(req.authenticatedUser.userId,q);}
 @Post('templates') @RequirePermission(owner) @Header('Cache-Control','no-store')
 template(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.drafts.saveTemplate(req.authenticatedUser.userId,body);}
 @Post('reviews') @RequirePermission(owner) @Header('Cache-Control','no-store')
 review(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.drafts.review(req.authenticatedUser.userId,body);}
 @Post() @RequirePermission(owner) @Header('Cache-Control','no-store')
 create(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.drafts.create(req.authenticatedUser.userId,body);}
 @Get(':id/pdf') @RequirePermission(owner) @Header('Cache-Control','no-store') @Header('X-Content-Type-Options','nosniff')
 async pdf(@Req() req:RequestWithAuthenticatedUser,@Param('id') id:string){return new StreamableFile(await this.drafts.pdf(req.authenticatedUser.userId,id),{type:'application/pdf',disposition:`attachment; filename="energyos-minuta-${id}.pdf"`});}
 @Get(':id') @RequirePermission(owner) @Header('Cache-Control','no-store')
 read(@Req() req:RequestWithAuthenticatedUser,@Param('id') id:string){return this.drafts.read(req.authenticatedUser.userId,id);}
}
