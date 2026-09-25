import {Controller,Get,Post,Body,Param} from '@nestjs/common';
import {OrganizationId} from '../../../common/decorators/tenant.decorator';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {ContractConfigurationsService} from '../services/configurations.service';
import {ManagementDto,PricePeriodDto,ServiceAgreementDto} from '../dto/configurations.dto';
@Controller('contract-configurations')
export class ContractConfigurationsController {
 constructor(private service:ContractConfigurationsService){}
 @Get('management') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) management(@OrganizationId() org:string){return this.service.listManagement(org);}
 @Post('management') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) createManagement(@Body() dto:ManagementDto,@OrganizationId() org:string){return this.service.createManagement(dto,org);}
 @Get('services') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) services(@OrganizationId() org:string){return this.service.listServices(org);}
 @Post('services') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) createService(@Body() dto:ServiceAgreementDto,@OrganizationId() org:string){return this.service.createService(dto,org);}
 @Get('energy/:id/prices') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) prices(@Param('id') id:string,@OrganizationId() org:string){return this.service.prices(id,org);}
 @Post('energy/:id/prices') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) addPrice(@Param('id') id:string,@Body() dto:PricePeriodDto,@OrganizationId() org:string){return this.service.addPrice(id,dto,org);}
}
