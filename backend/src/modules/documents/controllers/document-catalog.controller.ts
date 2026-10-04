import {Body,Controller,Get,Header,Param,Put} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {DocumentCatalogService,DocumentCatalogDto,DocumentFavoriteDto} from '../services/document-catalog.service';
@Controller('document-catalog')
export class DocumentCatalogController {
 constructor(private service:DocumentCatalogService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Tenant() t:TenantContext){return this.service.list(t);}
 @Get(':id/history') @Header('Cache-Control','private, no-store') history(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.history(id,t);}
 @Put(':id') save(@Param('id') id:string,@Body() d:DocumentCatalogDto,@Tenant() t:TenantContext){return this.service.save(id,d,t);}
 @Put(':id/favorite') favorite(@Param('id') id:string,@Body() d:DocumentFavoriteDto,@Tenant() t:TenantContext){return this.service.favorite(id,d,t);}
}
