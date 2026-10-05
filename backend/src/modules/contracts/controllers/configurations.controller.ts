import {Controller,Get,Post,Body,Param} from '@nestjs/common';
import {OrganizationId,Tenant} from '../../../common/decorators/tenant.decorator';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {ContractConfigurationsService} from '../services/configurations.service';
import {ManagementDto,PricePeriodDto,ServiceAgreementDto,VariableFeeCorrectionDto} from '../dto/configurations.dto';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
@Controller('contract-configurations')
export class ContractConfigurationsController {
 constructor(private service:ContractConfigurationsService){}
 @Get('management') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) management(@OrganizationId() org:string){return this.service.listManagement(org);}
 @Post('management') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) createManagement(@Body() dto:ManagementDto,@OrganizationId() org:string){return this.service.createManagement(dto,org);}
 @Get('management/:id/variable-corrections') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) variableCorrections(@Param('id') id:string,@OrganizationId() org:string){return this.service.variableCorrections(id,org);}
 @Post('management/:id/variable-correction') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) correctVariable(@Param('id') id:string,@Body() dto:VariableFeeCorrectionDto,@Tenant() t:TenantContext){return this.service.correctVariable(id,dto,t);}
 @Get('services') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) services(@OrganizationId() org:string){return this.service.listServices(org);}
 @Post('services') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) createService(@Body() dto:ServiceAgreementDto,@OrganizationId() org:string){return this.service.createService(dto,org);}
 @Get('energy/:id/prices') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) prices(@Param('id') id:string,@OrganizationId() org:string){return this.service.prices(id,org);}
 @Post('energy/:id/prices') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) addPrice(@Param('id') id:string,@Body() dto:PricePeriodDto,@OrganizationId() org:string){return this.service.addPrice(id,dto,org);}
}
