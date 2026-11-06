import {driCostCandidate} from '../ccee/ccee-dri-cost.service';
import {CCEE_DATA_PERMISSIONS} from '../ccee/ccee-data.model';
/** Read only local CCEE jobs, never enqueue a provider request or allocate a cost. */
export async function closingCceeLocal(db:any,t:any,unit:any,month:string){
 if(!t.permissions?.includes(CCEE_DATA_PERMISSIONS.view)&&t.accessMode!=='platform_operation')return {state:'NO_ACCESS',notice:'Consulta CCEE não autorizada para este perfil. Use fonte documental conferida.',candidates:[]};
 const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 const bindings:any[]=[],jobs:any[]=[];let complete=false,bindingsComplete=false,latest:any;
 for(let page=0;page<4;page++){
  const r=await db.rpc('ccee_data_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'list',p_id:null,p_body:{page}});
  if(r.error||!r.data)return {state:'UNAVAILABLE',notice:'Não foi possível conferir as referências CCEE locais. Nenhum custo foi presumido.',candidates:[]};
  bindings.push(...r.data.bindings??[]);jobs.push(...r.data.jobs??[]);
  bindingsComplete=bindingsComplete||(r.data.bindings??[]).length<25;
  if(bindingsComplete){
   latest=bindings.filter(b=>b.organization_id===t.organizationId&&b.customer_id===unit.customer_id&&b.consumer_unit_id===unit.id).sort((a,b)=>b.revision-a.revision)[0];
   if(!latest||latest.status!=='APPROVED'||typeof latest.valid_from!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(latest.valid_from)||latest.valid_from>start||latest.valid_to&&latest.valid_to<end||!latest.service_scope?.includes('DRI_READ'))return {state:'NO_BINDING',notice:'Não há representação DRI autorizada desta unidade cobrindo '+month+'. Cadastro identificado não libera coleta privada. Informe fonte documental desta competência; ausência não é zero.',candidates:[]};
   if((r.data.jobs??[]).length<25){complete=true;break;}
  }
 }
 if(!complete)return {state:'UNAVAILABLE',notice:bindingsComplete?'Histórico CCEE extenso; consulte Dados CCEE para conferir a referência completa.':'Catálogo de vínculos CCEE extenso; consulte Dados CCEE para conferir a representação desta unidade.',candidates:[]};
 const candidates:any[]=[];const eligible=jobs.filter(j=>j.authorization_id===latest.id&&j.kind==='DRI_RESULTS'&&j.state==='SUCCEEDED'&&String(j.month).slice(0,7)===month);
 if(eligible.length>6)return {state:'UNAVAILABLE',notice:'Há várias referências CCEE; confira as rubricas e duplicidades em Dados CCEE.',candidates:[]};
 for(const j of eligible){const r=await db.rpc('ccee_data_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'job',p_id:j.id,p_body:{}});if(r.error)continue;try{const c=driCostCandidate(r.data);if(c.unitId===unit.id&&c.customerId===unit.customer_id&&c.accountingMonth===month)candidates.push(c);}catch{/* unmapped rows never become costs */}}
 return {state:candidates.length?'CANDIDATES':'NO_ELIGIBLE_COST',notice:candidates.length?'Referências locais homologadas para conferir alocação e competência; não comprovam todos os encargos nem pagamento.':'Nenhuma rubrica financeira homologada local desta unidade/competência. Informe fonte documental ou confira a integração.',candidates};
}
