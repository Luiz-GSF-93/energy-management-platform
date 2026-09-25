import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesService } from '../licenses/services/licenses.service';
import { PERMISSIONS as P } from '../../common/constants/permissions';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';

@Injectable()
export class DashboardService {
  constructor(private readonly supabase: SupabaseService, private readonly licenses: LicensesService) {}
  private async count(table: string, organizationId?: string, filters: Array<[string, unknown]> = [], notDeleted = false) {
    let q = this.supabase.getClient().from(table).select('id', {count:'exact',head:true});
    if(organizationId) q=q.eq('organization_id',organizationId);
    if(notDeleted) q=q.is('deleted_at',null);
    for(const [key,value] of filters) q=q.eq(key,value);
    const {count,error}=await q;
    if(error || !Number.isSafeInteger(count) || count! < 0) throw new InternalServerErrorException('Não foi possível consultar os indicadores.');
    return count as number;
  }
  async platform() {
    const organizations=await this.count('organizations',undefined,[],true);
    return {scope:'global',organizationId:null,updatedAt:new Date().toISOString(),metrics:[{key:'organizations',label:'Organizações cadastradas',value:organizations,href:'/backoffice/organizations'}]};
  }
  async organization(tenant: TenantContext) {
    if(!tenant?.organizationId) throw new ForbiddenException('Organização não selecionada.');
    const org=tenant.organizationId, permitted=new Set(tenant.permissions);
    const metrics: Array<{key:string,label:string,value:number,href:string}>=[];
    const specs=[
      [P.ORGANIZATION_CUSTOMERS_VIEW,'customers','customers','Clientes cadastrados','/backoffice/setup',true],
      [P.ORGANIZATION_CONSUMER_UNITS_VIEW,'consumer_units','units','Unidades consumidoras','/backoffice/setup',false],
      [P.ORGANIZATION_CONTRACTS_VIEW,'energy_contracts','contracts','Contratos cadastrados','',false],
      [P.ORGANIZATION_USERS_VIEW,'organization_members','users','Usuários com vínculo ativo','/backoffice/users',false],
    ] as const;
    for(const [permission,table,key,label,href,notDeleted] of specs) {
      if(!permitted.has(permission)) continue;
      const value=await this.count(table,org,key==='users'?[['status','active']]:[],notDeleted);
      metrics.push({key,label,value,href});
    }
    let license: {name:string,documentsLimit:number,documentsUnlimited?:boolean,documentsUsed:number,endDate:string|null}|null|undefined;
    if(permitted.has(P.ORGANIZATION_LICENSES_VIEW)||permitted.has(P.DOCUMENTS_VIEW)) {
      const effective=await this.licenses.resolveEffectiveLicense(org);
      if(permitted.has(P.ORGANIZATION_LICENSES_VIEW)) license=effective?{name:effective.license_type,documentsLimit:effective.documents_limit,...(effective.documents_unlimited?{documentsUnlimited:true}:{}),documentsUsed:effective.documents_used??0,endDate:effective.end_date}:null;
      if(permitted.has(P.DOCUMENTS_VIEW)&&effective?.document_management===true){
        metrics.push({key:'documents',label:'Documentos cadastrados',value:await this.count('documents',org),href:'/backoffice/documents'});
        metrics.push({key:'pendingDocuments',label:'Documentos com processamento pendente',value:await this.count('documents',org,[['processing_status','PENDING']]),href:'/backoffice/documents'});
      }
    }
    return {scope:'organization',organizationId:org,updatedAt:new Date().toISOString(),metrics,...(license!==undefined?{license}:{})};
  }
}
