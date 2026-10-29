import {Controller,Get,Header,Query,BadRequestException} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {PublishedClientForecastService} from './published-client-forecast.service';
@Controller('portal/energy-forecasts')
export class PublishedClientForecastController {
 constructor(private service:PublishedClientForecastService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) list(@Tenant() t:TenantContext,@Query() q:Record<string,string>={}){if(Object.keys(q).some(k=>k!=='unitIds'))throw new BadRequestException('Filtro inválido.');return this.service.list(t,q.unitIds);}
}
