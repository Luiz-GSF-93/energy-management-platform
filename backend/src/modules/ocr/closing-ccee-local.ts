import {driCostCandidate} from '../ccee/ccee-dri-cost.service';
import {CCEE_DATA_PERMISSIONS} from '../ccee/ccee-data.model';
/** Read only local CCEE jobs, never enqueue a provider request or allocate a cost. */
export async function closingCceeLocal(db:any,t:any,unit:any,month:string){
 if(!t.permissions?.includes(CCEE_DATA_PERMISSIONS.view)&&t.accessMode!=='platform_operation')return {state:'NO_ACCESS',notice:'Consulta CCEE não autorizada para este perfil. Use fonte documental conferida.',candidates:[]};
 const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 const source=await db.rpc('ccee_closing_sources',{p_org:t.organizationId,p_actor:t.userId,p_unit:unit.id,p_month:month});
 const data=source.data;
 if(source.error||!data||data.organizationId!==t.organizationId||!Array.isArray(data.jobs)||data.jobs.length>32)return {state:'UNAVAILABLE',notice:'Não foi possível conferir as fontes CCEE completas desta unidade e competência. Nenhum custo foi presumido.',candidates:[]};
 const latest=data.binding,jobs=data.jobs;
 if(!latest||latest.organization_id!==t.organizationId||latest.customer_id!==unit.customer_id||latest.consumer_unit_id!==unit.id||latest.status!=='APPROVED'||typeof latest.valid_from!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(latest.valid_from)||latest.valid_from>start||latest.valid_to&&latest.valid_to<end||!latest.service_scope?.includes('DRI_READ'))return {state:'NO_BINDING',notice:'Não há representação DRI autorizada desta unidade cobrindo '+month+'. O preenchimento documental continua; use fonte conferida ou estimativa identificada.',candidates:[]};
 const allocationAmbiguous=data.allocationAmbiguous===true;
 const candidates:any[]=[];const eligible=jobs.filter((j:any)=>j.authorization_id===latest.id&&j.kind==='DRI_RESULTS'&&j.state==='SUCCEEDED'&&String(j.month).slice(0,7)===month);
 if(eligible.length>32)return {state:'UNAVAILABLE',notice:'Há várias referências CCEE; confira as rubricas e duplicidades em Dados CCEE.',candidates:[]};
 for(const j of eligible){const r=await db.rpc('ccee_data_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'job',p_id:j.id,p_body:{}});if(r.error)continue;try{const c=driCostCandidate(r.data);if(c.unitId===unit.id&&c.customerId===unit.customer_id&&c.accountingMonth===month)candidates.push({...c,sourceAt:j.finished_at??null});}catch{/* unmapped rows never become costs */}}
 return {allocationAmbiguous,state:candidates.length?'CANDIDATES':'NO_ELIGIBLE_COST',notice:candidates.length?'Referências locais homologadas para conferir alocação e competência; não comprovam todos os encargos nem pagamento.':'Nenhuma rubrica financeira homologada local desta unidade/competência. Informe fonte documental ou confira a integração.',candidates};
}
