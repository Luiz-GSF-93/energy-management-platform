import {Body,Controller,Get,Header,Post} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {CceeService} from './ccee.service';

// Operational checks are platform-only. Customer access continues through published dashboards.
@Controller('admin/integrations/ccee') @PlatformScope()
export class CceeController {
 constructor(private readonly service:CceeService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.PLATFORM_ORGANIZATIONS_VIEW]) status(){return this.service.status();}
 @Post('test') @RequirePermission([P.PLATFORM_ORGANIZATIONS_VIEW]) test(){return this.service.probe();}
 @Post('pld-preview') @Header('Cache-Control','private, no-store') @RequirePermission([P.PLATFORM_ORGANIZATIONS_VIEW]) preview(@Body() input:unknown){return this.service.preview(input);}
}
