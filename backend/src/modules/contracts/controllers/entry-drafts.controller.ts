import {Controller,Get,Post,Put,Body,Param,ParseUUIDPipe} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {EntryDraftService} from '../services/entry-drafts.service';
import {EntryDraftDto,UpdateEntryDraftDto,EntryRevisionDto} from '../dto/entry-drafts.dto';
@Controller('contract-entry-drafts')
export class EntryDraftController {
 constructor(private service:EntryDraftService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Tenant() t:TenantContext){return this.service.list(t);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) create(@Body() d:EntryDraftDto,@Tenant() t:TenantContext){return this.service.create(d,t);}
 @Put(':id') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateEntryDraftDto,@Tenant() t:TenantContext){return this.service.update(id,d,t);}
 @Post(':id/register') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) register(@Param('id',ParseUUIDPipe) id:string,@Body() d:EntryRevisionDto,@Tenant() t:TenantContext){return this.service.register(id,d,t);}
}
