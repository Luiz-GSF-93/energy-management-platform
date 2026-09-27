import {Controller,Get,Post,Param,Body,Req,ForbiddenException} from '@nestjs/common';
import {OrganizationId,UserId} from '../../../common/decorators/tenant.decorator';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../../common/constants/permissions';
import {DemandPeriodsService} from '../services/demand-periods.service';
@Controller('consumer-units/:id/demand-periods')
export class DemandPeriodsController{
 constructor(private service:DemandPeriodsService){}
 private documents(req:any){const permissions=(req.accessContext||req.tenantContext)?.permissions;if(!Array.isArray(permissions)||!permissions.includes(PERMISSIONS.DOCUMENTS_VIEW))throw new ForbiddenException('Permissão de consulta de documentos necessária.');}
 @Get() @RequirePermission([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_VIEW]) async list(@OrganizationId() org:string,@Param('id') id:string,@Req() req:any){this.documents(req);return {...await this.service.list(org,id),canValidate:this.service.canValidate(req.tenantContext)};}
 @Post() @RequirePermission([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_UPDATE]) create(@OrganizationId() org:string,@Param('id') id:string,@UserId() actor:string,@Body() body:unknown,@Req() req:any){this.documents(req);return this.service.create(org,id,actor,body);}
 @Post(':periodId/validate') @RequirePermission([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_UPDATE]) validate(@OrganizationId() org:string,@Param('id') id:string,@Param('periodId') periodId:string,@Body() body:unknown,@Req() req:any){this.documents(req);return this.service.validate(org,id,periodId,req.tenantContext,body);}
}
