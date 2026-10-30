import {ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
@Injectable()
export class AneelTariffFlagsService{
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 async status(t:TenantContext){
  if(!t?.organizationId||t.scope!=='organization'||!(t.accessMode==='platform_operation'||['admin_org','gestor','operacional'].includes(t.role))||!t.permissions?.includes(P.ORGANIZATION_CONTRACTS_VIEW))throw new ForbiddenException('Consulta restrita ao backoffice autorizado.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  const r=await this.db.getClient().rpc('aneel_flag_status',{p_org:t.organizationId});if(r.error||!r.data)throw new ServiceUnavailableException('Atualização oficial indisponível; referências anteriores preservadas.');return r.data;
 }
 async reference(org:string,month:string){
  const r=await this.db.getClient().rpc('aneel_flag_reference',{p_org:org,p_month:month});if(r.error)throw new ServiceUnavailableException('Não foi possível conferir a referência oficial da bandeira.');return r.data??null;
 }
}
