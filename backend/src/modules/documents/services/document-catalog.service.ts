import {Injectable,ForbiddenException,BadRequestException,ConflictException,NotFoundException,InternalServerErrorException} from '@nestjs/common';
import {IsBoolean,IsIn,IsInt,IsString,Length,Min} from 'class-validator';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
export class DocumentCatalogDto {
 @IsInt() @Min(1) revision!:number;
 @IsIn(['DRAFT','APPROVED','MODEL','SIGNING','RELEASED','OBSOLETE','REVIEWED']) tag!:string;
 @IsString() @Length(20,1000) reason!:string;
 @IsBoolean() checkedDocument!:boolean;
}
export class DocumentFavoriteDto {@IsBoolean() favorite!:boolean;}
@Injectable()
export class DocumentCatalogService {
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 private async allowed(t:TenantContext,write=false){if(!t.userId||!t.organizationId||(t.scope as string)==='global'||!(['operacional','gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation')||!t.permissions?.includes(P.DOCUMENTS_VIEW)||write&&!t.permissions.includes(P.DOCUMENTS_UPDATE))throw new ForbiddenException('Selecione um perfil backoffice autorizado a gerenciar documentos.');await this.licenses.requireEntitlement(t.organizationId,'document_management');}
 private check(e:any){if(!e)return;if(e.code==='P2071')throw new ForbiddenException('Conferência, perfil ou licença indisponível.');if(e.code==='P2072')throw new ConflictException('O documento mudou. Atualize a versão antes de continuar.');if(e.code==='P2073')throw new NotFoundException('Documento indisponível nesta organização.');throw new InternalServerErrorException('Não foi possível consultar o catálogo de documentos.');}
 private async all(make:()=>any){const rows:any[]=[];for(let n=0;n<20000;n+=200){const r=await make().range(n,n+199);this.check(r.error);if(!Array.isArray(r.data))throw new InternalServerErrorException('Catálogo indisponível.');rows.push(...r.data);if(r.data.length<200)return rows;}throw new BadRequestException('Catálogo extenso; nenhum conjunto parcial foi emitido.');}
 async list(t:TenantContext){await this.allowed(t);const from=(name:string)=>this.db.getClient().from(name);const [docs,catalog,favorites,customers,units]=await Promise.all([
 this.all(()=>from('documents_with_intake').select('*').eq('organization_id',t.organizationId).order('created_at',{ascending:false}).order('id')),
 this.all(()=>from('document_catalog').select('*').eq('organization_id',t.organizationId).order('document_id')),
 this.all(()=>from('document_favorites').select('document_id').eq('organization_id',t.organizationId).eq('actor_id',t.userId).order('document_id')),
 this.all(()=>from('customers').select('id,company_name').eq('organization_id',t.organizationId).is('deleted_at',null).order('id')),
 this.all(()=>from('consumer_units').select('id,customer_id,name,consumer_unit_number').eq('organization_id',t.organizationId).order('id'))]);
 const latest=new Map<string,number>();for(const c of catalog)latest.set(c.series_id,Math.max(latest.get(c.series_id)??0,c.version));
 return {documents:docs.map(d=>{const c=catalog.find(c=>c.document_id===d.id);if(!c)throw new ConflictException('Catálogo incompleto. Atualize após a implantação administrativa.');return {...d,catalog:c,currentVersion:c.version===latest.get(c.series_id),code:'DOC-'+c.series_id.slice(0,8).toUpperCase(),favorite:favorites.some(f=>f.document_id===d.id),customerName:customers.find(v=>v.id===d.customer_id)?.company_name??'Cliente indisponível',unitName:units.find(v=>v.id===d.consumer_unit_id)?.name??'Unidade indisponível',unitCode:units.find(v=>v.id===d.consumer_unit_id)?.consumer_unit_number??''};}),customers,units};
 }
 async history(id:string,t:TenantContext){await this.allowed(t);const c=await this.db.getClient().from('document_catalog').select('*').eq('organization_id',t.organizationId).eq('document_id',id).maybeSingle();this.check(c.error);if(!c.data)throw new NotFoundException('Documento indisponível.');const versions=await this.all(()=>this.db.getClient().from('document_catalog').select('*').eq('organization_id',t.organizationId).eq('series_id',c.data.series_id).order('version'));const events=await this.all(()=>this.db.getClient().from('document_catalog_events').select('*').eq('organization_id',t.organizationId).eq('document_id',id).order('revision'));return {versions,events};}
 async save(id:string,input:DocumentCatalogDto,t:TenantContext){await this.allowed(t,true);const d=await validateWriteDto(DocumentCatalogDto,input);if(!d.checkedDocument)throw new BadRequestException('Confira o documento antes de classificar.');if(['APPROVED','RELEASED'].includes(d.tag)&&!(['gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation'))throw new ForbiddenException('Aprovação documental exige gestor ou administrador.');const r=await this.db.getClient().rpc('save_document_catalog',{p_org:t.organizationId,p_actor:t.userId,p_document:id,p_revision:d.revision,p_tag:d.tag,p_reason:d.reason.trim(),p_checked:d.checkedDocument});this.check(r.error);return r.data;}
 async favorite(id:string,input:DocumentFavoriteDto,t:TenantContext){await this.allowed(t);const d=await validateWriteDto(DocumentFavoriteDto,input),r=await this.db.getClient().rpc('favorite_document',{p_org:t.organizationId,p_actor:t.userId,p_document:id,p_favorite:d.favorite});this.check(r.error);return {favorite:d.favorite};}
}
