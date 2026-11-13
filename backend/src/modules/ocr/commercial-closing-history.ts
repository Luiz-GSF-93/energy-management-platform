import {ConflictException,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {readRpc} from '../../common/services/read-deadline';
import {observeEvaStage} from '../../common/services/eva-stage-metrics';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';

/** Preserve month/scope/page order without opening twelve database requests at once.
 * No cache: each preparation still checks the current authorized history. */
export async function commercialClosingHistory(db:any,t:TenantContext,unit:string,customer:string,months:string[],mode:string){
 const result:any[]=[];
 for(const month of months){
  for(const scope of ['CUSTOMER','UNIT']){
   const rows:any[]=[];
   for(let page=0;page<10;page++){
    const response=await observeEvaStage('CCEE_HISTORY_READ',()=>readRpc(db,'eva_scoped_closing_action',{
     p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',
     p_action:'history',p_disclose:false,p_mode:mode,p_scope:scope,p_unit:unit,p_month:month,p_id:null,p_body:{page},
    }));
    if(response?.error?.code==='42501')throw new ForbiddenException('Contexto ou acesso da preparação indisponível.');
    if(['23505','PT409','40001'].includes(response?.error?.code))throw new ConflictException('Fontes ou execução mudaram. Reconfira o histórico.');
    if(response?.error||!response?.data)throw new ServiceUnavailableException('Histórico CCEE temporariamente indisponível.');
    const h=response.data;
    if(!Array.isArray(h.rows)||!Number.isInteger(h.total)||h.total<0||h.total>100)throw new ServiceUnavailableException('Histórico CCEE aprovado incompleto.');
    if(h.rows.some((r:any)=>r.organization_id!==t.organizationId||r.customer_id!==customer||r.month!==month))throw new ConflictException('Histórico CCEE fora do escopo.');
    rows.push(...h.rows);
    if(rows.length>=h.total)break;
    if(!h.rows.length||page===9)throw new ServiceUnavailableException('Histórico CCEE truncado.');
   }
   result.push(...rows.map(r=>({...r,evidenceFormat:'EVA_APPROVED',version_number:r.version})));
  }
 }
 return result;
}
