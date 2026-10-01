import {Body,Controller,Get,Param,ParseUUIDPipe,Post,ForbiddenException} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {TariffLibraryService} from '../services/tariff-library.service';
import {LibraryWriteDto,LibraryApplyDto} from '../dto/tariff-library.dto';
@Controller('tariff-library')
export class TariffLibraryController {
 constructor(private service:TariffLibraryService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Tenant() t:TenantContext){return this.service.list(t.organizationId);}
 @Get('elektro-seed') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) seed(@Tenant() t:TenantContext){return this.service.seed(t.organizationId);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE,P.ORGANIZATION_CONTRACTS_UPDATE]) save(@Body() d:LibraryWriteDto,@Tenant() t:TenantContext){if(!t.permissions.includes(d.previousId?P.ORGANIZATION_CONTRACTS_UPDATE:P.ORGANIZATION_CONTRACTS_CREATE))throw new ForbiddenException('Sem permissão para esta alteração.');return this.service.save(d,t.organizationId,t.userId);}
 @Post(':id/preview') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) preview(@Param('id',ParseUUIDPipe) id:string,@Body() d:LibraryApplyDto,@Tenant() t:TenantContext){return this.service.preview(id,d,t.organizationId);}
 @Post(':id/apply') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) apply(@Param('id',ParseUUIDPipe) id:string,@Body() d:LibraryApplyDto,@Tenant() t:TenantContext){if(!t.permissions.includes(P.ORGANIZATION_CONTRACTS_UPDATE))throw new ForbiddenException('A aplicação em lote exige permissão para atualizar custos e parâmetros.');return this.service.apply(id,d,t.organizationId,t.userId);}
}
