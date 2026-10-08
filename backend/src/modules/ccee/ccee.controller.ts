import {Body,Controller,Get,Header,Post,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {CceeService} from './ccee.service';
import {CceePublicationService} from './ccee-publication.service';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';

// Operational checks are platform-only. Customer access continues through published dashboards.
@Controller('admin/integrations/ccee') @PlatformScope()
export class CceeController {
 constructor(private readonly service:CceeService,private readonly publications:CceePublicationService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.PLATFORM_ORGANIZATIONS_VIEW]) status(){return this.service.status();}
 @Post('test') @RequirePermission([P.PLATFORM_ORGANIZATIONS_VIEW]) test(){return this.service.probe();}
 @Post('pld-preview') @Header('Cache-Control','private, no-store') @RequirePermission([P.PLATFORM_ORGANIZATIONS_VIEW]) preview(@Body() input:unknown){return this.service.preview(input);}
 @Post('pld-publish') @Header('Cache-Control','private, no-store') @RequirePermission([P.PLATFORM_ORGANIZATIONS_UPDATE]) publish(@Body() input:unknown,@Req() req:RequestWithTenant){return this.publications.publish(input,req.accessContext);}
}
