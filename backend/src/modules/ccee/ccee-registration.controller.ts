import {Body,Controller,Get,Header,Param,Post} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CceeRegistrationService} from './ccee-registration.service';
@Controller('ccee-registrations')
export class CceeRegistrationController {
 constructor(private service:CceeRegistrationService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Tenant() t:TenantContext){return this.service.list(t);}
 @Get(':id/history') @Header('Cache-Control','private, no-store') history(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.history(id,t);}
 @Post() save(@Body() input:unknown,@Tenant() t:TenantContext){return this.service.save(input,t);}
 @Post(':id/transition') transition(@Param('id') id:string,@Body() input:unknown,@Tenant() t:TenantContext){return this.service.transition(id,input,t);}
}
