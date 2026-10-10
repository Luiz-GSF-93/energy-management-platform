import {Body,Controller,Get,Header,Post,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {TEAM_MANAGE} from '../platform-team/platform-team.permissions';
import {CceeService} from './ccee.service';
import {CceePublicationService} from './ccee-publication.service';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';

// Operational checks are platform-only. Customer access continues through published dashboards.
@Controller('admin/integrations/ccee') @PlatformScope()
export class CceeController {
 constructor(private readonly service:CceeService,private readonly publications:CceePublicationService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([TEAM_MANAGE]) status(){return this.service.status();}
 @Post('test') @RequirePermission([TEAM_MANAGE]) test(){return this.service.probe();}
 @Post('pld-preview') @Header('Cache-Control','private, no-store') @RequirePermission([TEAM_MANAGE]) preview(@Body() input:unknown){return this.service.preview(input);}
 @Post('pld-publish') @Header('Cache-Control','private, no-store') @RequirePermission([TEAM_MANAGE]) publish(@Body() input:unknown,@Req() req:RequestWithTenant){return this.publications.publish(input,req.accessContext);}
}
