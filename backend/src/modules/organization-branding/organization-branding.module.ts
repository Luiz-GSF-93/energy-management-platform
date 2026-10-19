import {Module,Controller,Get,Patch,Body,Header} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {SupabaseService} from '../../services/supabase.service';
import {OrganizationBrandingService} from './organization-branding.service';
@Controller('organization-branding')
class OrganizationBrandingController {
 constructor(private readonly branding:OrganizationBrandingService){}
 @Get() @Header('Cache-Control','no-store') read(@Tenant() t:TenantContext){return this.branding.read(t);}
 @Patch() @Header('Cache-Control','no-store') save(@Tenant() t:TenantContext,@Body() input:unknown){return this.branding.save(t,input);}
}
@Module({controllers:[OrganizationBrandingController],providers:[SupabaseService,OrganizationBrandingService],exports:[OrganizationBrandingService]})
export class OrganizationBrandingModule {}
