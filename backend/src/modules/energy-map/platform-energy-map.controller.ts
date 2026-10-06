import {Controller,Get,Header,Query} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {Access} from '../../common/decorators/access-context.decorator';
import {AccessContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../common/constants/permissions';
import {PlatformEnergyMapService} from './platform-energy-map.service';

@Controller('admin/energy-map')
@PlatformScope()
export class PlatformEnergyMapController {
 constructor(private service:PlatformEnergyMapService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_VIEW])
 read(@Query() query:Record<string,unknown>,@Access() context:AccessContext){return this.service.read(query,context);}
}
