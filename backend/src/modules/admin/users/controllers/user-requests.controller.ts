import {Body,Controller,Get,Header,Param,Post,Query} from '@nestjs/common';
import {Tenant} from '../../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../../common/interfaces/tenant-context.interface';
import {UserRequestsService} from '../services/user-requests.service';
@Controller('admin/user-requests')
export class UserRequestsController{
 constructor(private requests:UserRequestsService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Tenant() t:TenantContext,@Query() q:Record<string,string>){return this.requests.list(t,q);}
 @Get('catalog') @Header('Cache-Control','private, no-store') catalog(@Tenant() t:TenantContext){return this.requests.catalog(t);}
 @Post('permissions') permissions(@Tenant() t:TenantContext,@Body() b:unknown){return this.requests.submitPermissions(b,t);}
 @Post(':id/decision') decision(@Tenant() t:TenantContext,@Param('id') id:string,@Body() b:unknown){return this.requests.decide(id,b,t);}
}
