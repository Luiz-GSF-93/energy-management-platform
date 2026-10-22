import {previousCalculationReference} from './calculation-autofill-reference';
import {reviewDigest} from '../contracts/services/review-snapshots.service';
export const cceeEstimateEnabled=()=>process.env.CCEE_COST_ESTIMATE_ENABLED==='true';
const normal=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const monthNumber=(s:string)=>Number(s.slice(0,4))*12+Number(s.slice(5,7));
const cents=(s:unknown)=>{if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,11})(\.\d{1,2})?$/.test(s))throw Error();const [w,f='']=s.split('.');return BigInt(w)*100n+BigInt(f.padEnd(2,'0'));};
const money=(n:bigint)=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
function evidence(r:any,unit:any,month:string){
 if(r.evidenceFormat==='EVA_APPROVED'){
  const p=r.report,events=r.events;
  if(r.state!=='APPROVED'||!Array.isArray(events)||!events.length||events.some((e:any)=>e.closing_id!==r.id||e.organization_id!==unit.organization_id)||events.some((e:any)=>events.filter((x:any)=>x.sequence===e.sequence).length!==1))return null;
  const last=[...events].sort((a,b)=>b.sequence-a.sequence)[0];
  if(last.state!=='APPROVED'||!last.actor_id||!last.created_at||p?.formatVersion!=='eva-assisted-closing-1.0'||p.organizationId!==unit.organization_id||p.customerId!==unit.customer_id||p.month!==r.month||reviewDigest(p)!==r.payload_hash||p.financial?.status!=='AVAILABLE'||p.cceeEstimate?.state==='ESTIMATED'||!Array.isArray(p.units))return null;
  const units=p.units.filter((u:any)=>u.id===unit.id);if(units.length!==1)return null;
  const u=units[0];if(u.prepared?.ccee?.state==='ESTIMATED'||u.sources?.cceeEstimate?.state==='ESTIMATED')return null;
  const fields=u.fields?.filter((f:any)=>f.key==='costs:monthly'&&f.state==='FILLED'&&f.source?.trim());
  if(fields?.length!==1||!Array.isArray(fields[0].value?.items))return null;
  return {items:fields[0].value.items,costId:null,revision:null,approvalEventId:last.id,approvedBy:last.actor_id,approvedAt:last.created_at,financialHash:r.payload_hash};
 }
 if(!previousCalculationReference([r],unit,month))return null;
 const cost=r.financial_payload.preparations[unit.id].costs?.validatedVersion;
 if(!cost?.id||!Number.isInteger(cost.revision)||!cost.validatedAt||!Array.isArray(cost.costs?.items))return null;
 return {items:cost.costs.items,costId:cost.id,revision:cost.revision,approvalEventId:null,approvedBy:null,approvedAt:cost.validatedAt,financialHash:r.financial_hash};
}
/** Private proposal only. Confirmed settlement hashes and cost revisions remain the sources. */
export function cceeCostEstimate(rows:any[],unit:any,month:string,currentItems:any[]=[]){
 const result:any={format:'ccee-weighted-estimate-1',month,state:'UNAVAILABLE',method:'RECENCY_3_2_1',items:[],total:null,reviewRequired:true,financialApproval:false,observations:['Estimativa CCEE: revisar no backoffice antes de aprovar. Garantias e penalidades não são projetadas automaticamente.']};
 if(currentItems.some(i=>i.category==='CCEE'&&i.scenario==='ACL'))return {...result,state:'CURRENT_RECORD',observations:['Registro CCEE atual preservado; nenhuma estimativa o substitui.']};
 const scoped=rows.filter(r=>r.organization_id===unit.organization_id&&r.customer_id===unit.customer_id&&(r.evidenceFormat==='EVA_APPROVED'||r.consumer_unit_id===unit.id)&&String(r.month).slice(0,7)<month&&monthNumber(month)-monthNumber(String(r.month).slice(0,7))<=6);
 const months=[...new Set(scoped.map(r=>String(r.month).slice(0,7)))].sort().reverse();
 const samples=new Map<string,any[]>();
 for(const m of months){
  const all=scoped.filter(r=>String(r.month).slice(0,7)===m),approved=all.filter(r=>r.evidenceFormat==='EVA_APPROVED'&&r.state==='APPROVED');
  const versions=(approved.length?approved:all.filter(r=>r.evidenceFormat!=='EVA_APPROVED')).sort((a,b)=>b.version_number-a.version_number),head=versions[0];
  if(!head)continue;
  if(versions.filter(r=>r.version_number===head.version_number).length!==1)continue;
  const proof=evidence(head,unit,month);if(!proof)continue;
  const items=proof.items.filter((i:any)=>i.category==='CCEE'&&i.scenario==='ACL');
  if(items.some((i:any)=>{try{cents(i.amount);return !i.id||!normal(i.source)||!normal(i.label)||!['COST','CREDIT'].includes(i.effect)||/ESTIMAD|ESTIMAT|PONDERAD|PROJECAO/.test(normal(i.source)+' '+normal(i.label));}catch{return true;}}))continue;
  const monthly=new Map<string,any>();
  if(new Set(items.map((i:any)=>i.id)).size!==items.length)continue;
  for(const item of items){
   const label=normal(item.label),source=normal(item.source);
   // Text alone cannot make an estimated record eligible as an actual observation.
   const collateral=/GARANTIA/.test(label)&&!/\bSEM (?:APORTE DE )?GARANTIA\b/.test(label);
   if(!label||!item.id||!source||/ESTIMAD|ESTIMAT|PONDERAD|PROJECAO/.test(label+' '+source)||collateral||/PENALIDADE/.test(label)||!['COST','CREDIT'].includes(item.effect))continue;
   try{cents(item.amount);}catch{continue;}
   const key='CCEE_OPERATING|'+item.effect;
   const group=monthly.get(key)??{amount:0n,items:[],effect:item.effect};
   group.amount+=cents(item.amount);group.items.push({id:item.id,label:item.label,amount:item.amount,source:item.source});monthly.set(key,group);
  }
  for(const [key,group] of monthly){
   const list=samples.get(key)??[];
   if(list.length<3)list.push({month:m,amount:money(group.amount),settlementId:head.id,version:head.version_number,financialHash:proof.financialHash,costId:proof.costId,revision:proof.revision,approvalEventId:proof.approvalEventId,approvedBy:proof.approvedBy,approvedAt:proof.approvedAt,items:group.items,label:group.effect==='CREDIT'?'Créditos operacionais CCEE':'Custos operacionais CCEE',effect:group.effect});
   samples.set(key,list);
  }
 }
 for(const [key,values] of samples){
  if(!values.length)continue;
  let numerator=0n,denominator=0n;
  const sources=values.map((v,i)=>{const weight=3-i;numerator+=cents(v.amount)*BigInt(weight);denominator+=BigInt(weight);return {...v,weight};});
  const amount=money((numerator+denominator/2n)/denominator);
  result.items.push({key,label:values[0].label,effect:values[0].effect,category:'CCEE',scenario:'ACL',amount,nature:'ESTIMATED',sources,coverage:values.length,reviewRequired:true});
 }
 if(result.items.length){result.state='ESTIMATED';const total=result.items.reduce((n:bigint,i:any)=>n+cents(i.amount)*(i.effect==='CREDIT'?-1n:1n),0n);result.total=(total<0n?'-':'')+money(total<0n?-total:total);}
 if(result.items.some((i:any)=>i.coverage===1))result.observations.push('Baixa cobertura: uma ou mais rubricas têm somente um mês confirmado.');
 if(!result.items.length)result.observations.push('Sem histórico real elegível; informar custos CCEE, sem presumir zero.');
 return result;
}
