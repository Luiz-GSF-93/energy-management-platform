import {DiagnosticRequestsService,DiagnosticRequestDto} from './diagnostic-requests.service';
import {BadRequestException,Body,Controller,Get,Param,Post,Put,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OperationsService} from './operations.service';
import {OperationWriteDto,OperationTransitionDto,NotificationReadDto} from './operations.dto';
@Controller('operations')
export class OperationsController {
 constructor(private service:OperationsService,private diagnostics:DiagnosticRequestsService){}
 @Get('responsible') responsible(@Tenant() t:TenantContext){return this.service.responsible(t);}
 @Get('notifications') notifications(@Tenant() t:TenantContext,@Query('sources') sources?:string){if(sources!==undefined&&sources!=='1')throw new BadRequestException('Origem de notificações inválida.');return this.service.notifications(t,sources==='1');}
 @Post('notifications/read') read(@Body() d:NotificationReadDto,@Tenant() t:TenantContext){return this.service.markRead(d,t);}
 @Get('diagnostic-documents/:id') diagnostic(@Param('id') id:string,@Tenant() t:TenantContext){return this.diagnostics.inspect(id,t);}
 @Post('diagnostic-documents/:id') diagnosticRequest(@Param('id') id:string,@Body() d:DiagnosticRequestDto,@Tenant() t:TenantContext){return this.diagnostics.create(id,d,t);}
 @Get(':kind') list(@Param('kind') k:string,@Query() q:{from?:string;to?:string;customerId?:string},@Tenant() t:TenantContext){return this.service.list(k,t,q);}
 @Get(':kind/:id/history') history(@Param('kind') k:string,@Param('id') id:string,@Tenant() t:TenantContext){return this.service.history(id,k,t);}
 @Post(':kind') create(@Param('kind') k:string,@Body() d:OperationWriteDto,@Tenant() t:TenantContext){return this.service.save(k,null,d,t);}
 @Put(':kind/:id') update(@Param('kind') k:string,@Param('id') id:string,@Body() d:OperationWriteDto,@Tenant() t:TenantContext){return this.service.save(k,id,d,t);}
 @Post(':kind/:id/transition') transition(@Param('kind') k:string,@Param('id') id:string,@Body() d:OperationTransitionDto,@Tenant() t:TenantContext){return this.service.transition(id,k,d,t);}
}
