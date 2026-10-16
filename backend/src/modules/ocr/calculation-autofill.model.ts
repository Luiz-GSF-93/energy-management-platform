import {createHash} from 'node:crypto';
import {adjustedContracts} from '../contracts/services/fee-adjustment';
import {monthPeriod} from '../contracts/services/preparation';
import {validateProfile} from '../contracts/services/tariff-library-plan';
import {parameterIssues} from '../contracts/services/parameter-issues';
import {feeCents,feeMoney,allocationUnits,allocateFee} from '../contracts/services/management-fee';
import {measurementIssues} from '../contracts/services/monthly-inputs';

export type FillField={key:string;label:string;value:unknown;unit:string;scenario:string;source:string;state:'FILLED'|'PENDING';observation:string|null};
export const autofillHash=(v:unknown):string=>{
 const canonical=(x:any):any=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
 return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
};
const norm=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const tariffClass=(v:unknown)=>norm(v)==='COMERCIAL'?'COMMERCIAL':norm(v);
const distributor=(v:unknown)=>norm(v)==='NEOENERGIAELEKTRO'?'ELEKTRO':norm(v);
export function proposedRegularSupplierAmount(s:any,measurements:any):string|null{
 if(s?.regularAmount!=null)return s.regularAmount;
 const scale=(v:unknown)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})(\.\d{1,12})?$/.test(v))throw Error();const [w,f='']=v.split('.');return BigInt(w)*10n**12n+BigInt(f.padEnd(12,'0'));};
 try{const price=scale(s.pricePerMwh),contracted=scale(s.contractedMwh),consumed=scale(measurements.consumptionTotal)/1000n;
  let billed=contracted;
  if(s.formulaVersion!=='spot-supplier-1.0'){const minimum=scale(s.minMwh),maximum=scale(s.maxMwh);if(minimum>maximum)return null;billed=consumed<minimum?minimum:consumed>maximum?maximum:consumed;}
  const divisor=10n**24n;return feeMoney((billed*price*100n+divisor/2n)/divisor);
 }catch{return null;}
}
export function selectAutofillLibrary(rows:any[],u:any,month:string){
 const p=monthPeriod(month),scoped=rows.filter(r=>r.organization_id===u.organization_id),heads=scoped.filter(r=>!scoped.some(n=>n.previous_id===r.id));
 const eligible=heads.filter(r=>{const x=r.profile;try{validateProfile(x);if(!x.source?.trim()||!x.items.length||x.items.length>20||x.items.some((i:any)=>!['TE','TUSD_ENERGY','TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED','REACTIVE'].includes(i.component)||!['PEAK','OFF_PEAK','ALL'].includes(i.band)||typeof i.value!=='string'||!/^(0|[1-9][0-9]{0,8})(\.\d{1,6})?$/.test(i.value)))return false;}catch{return false;}return x.startDate<=p.start&&x.endDate>=p.end&&distributor(x.distributor)===distributor(u.distributor)&&norm(x.group)===norm(u.tariff_group)&&norm(x.subgroup)===norm(u.tariff_subgroup)&&x.modality===u.tariff_modality&&(x.consumptionClass==='GENERAL'||tariffClass(x.consumptionClass)===tariffClass(u.consumption_class));});
 return {record:eligible.length===1?eligible[0]:null,state:eligible.length===1?'MATCHED':eligible.length?'AMBIGUOUS':'MISSING'};
}
/** A candidate is not a financial validation. No fabricated zero or attestation. */
export function calculationAutofillPlan(c:any,libraries:any[]){
 const u=c.unit,period=monthPeriod(c.month),fields:FillField[]=[],observations:string[]=[];
 const add=(key:string,label:string,value:unknown,unit:string,scenario:string,source:string,observation:string|null=null)=>{
  const present=value!==null&&value!==undefined&&value!==''&&!!source;
  fields.push({key,label,value:present?value:null,unit,scenario,source,state:present?'FILLED':'PENDING',observation:observation??(present?null:'Fonte não disponível para este campo.')});
 };
 add('unit','Unidade',u.name,'','BOTH','Cadastro '+u.id);add('month','Competência',c.month,'','BOTH','Fatura '+c.document.id);
 for(const [key,label] of Object.entries({distributor:'Distribuidora',tariff_group:'Grupo tarifário',tariff_subgroup:'Subgrupo tarifário',tariff_modality:'Modalidade',consumption_class:'Classe de consumo'}))add('unit:'+key,label,u[key]??null,'','BOTH','Cadastro '+u.id);
 if(u.tariff_group==='A')for(const key of u.tariff_modality==='BLUE'?['contracted_demand_peak','contracted_demand_off_peak']:['contracted_demand'])add('unit:'+key,'Demanda contratada · '+key,u[key]??null,'kW','BOTH','Cadastro '+u.id);
 const src='Fatura '+c.document.id+' · SHA-256 '+c.document.file_hash;
 for(const key of ['consumptionTotal','consumptionPeak','consumptionOffPeak'])add(key,{consumptionTotal:'Consumo total',consumptionPeak:'Consumo ponta',consumptionOffPeak:'Consumo fora ponta'}[key]!,c.measurements[key]??null,'kWh','BOTH',src);
 const demands=c.technical?.demand??[];
 const byMeter=demands.length===2&&demands.every((x:any)=>typeof x.meter?.decimal==='string');
 if(u.tariff_modality==='GREEN'){
  let value=c.measurements.demandSingle??null;
  if(byMeter&&!value){const scale=(s:string)=>{if(!/^\d+(\.\d{1,6})?$/.test(s))throw Error();const [w,f='']=s.split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};try{value=scale(demands[0].meter.decimal)>=scale(demands[1].meter.decimal)?demands[0].meter.decimal:demands[1].meter.decimal;}catch{value=null;}}
  add('demandSingle','Demanda medida',value,'kW','BOTH',c.measurements.demandSingle?c.input?.source_reference??'':byMeter?src+' · quadro de medição':'',demands.some((d:any)=>d.state==='DIFFERENT_REPRESENTATIONS')?'Quadro de medição e histórico possuem precisões diferentes; conferir a fonte indicada.':null);
 }else for(const key of ['demandPeak','demandOffPeak'])add(key,key==='demandPeak'?'Demanda medida ponta':'Demanda medida fora ponta',c.measurements[key]??null,'kW','BOTH',c.input?.source_reference??src);
 for(const [key,value] of Object.entries(c.measurements))if(key.startsWith('reactive'))add(key,'Reativo · '+key,value,key==='reactiveTotal'?'kVArh':'kWh','BOTH',src);
 for(const r of c.rates)add('ACL:'+r.component+':'+r.band,r.label,r.amount,r.measure,'ACL',r.source,r.state==='CONFLICT'?'Tarifa já cadastrada diverge; registro preservado.':null);
 if(c.cip.ready)add('cip','Iluminação pública',c.cip.amount,'BRL','ACL',src+' · '+c.cip.source);
 add('costs:monthly','Custos e créditos mensais',c.cost?.costs??null,'','BOTH',c.cost?.source_reference??'',c.cost?'Versão '+c.cost.version+' · proposta/registro preservado; não somar novamente a NF do fornecedor.':null);
 const library=selectAutofillLibrary(libraries,u,c.month),lib=library.record;
 if(lib){for(const i of lib.profile.items)add('ACR:'+i.component+':'+i.band,i.label,i.value,i.measure,'ACR','Biblioteca '+lib.id+' v'+lib.version+' · '+lib.profile.source);
  const required=[...(['GREEN','BLUE','WHITE'].includes(u.tariff_modality)?['TE:PEAK','TE:OFF_PEAK','TUSD_ENERGY:PEAK','TUSD_ENERGY:OFF_PEAK']:['TE:ALL','TUSD_ENERGY:ALL']),...(u.tariff_group==='A'?(u.tariff_modality==='BLUE'?['TUSD_DEMAND_USED:PEAK','TUSD_DEMAND_USED:OFF_PEAK']:['TUSD_DEMAND_USED:ALL']):[])];
  for(const key of required)if(!lib.profile.items.some((i:any)=>i.component+':'+i.band===key))add('ACR:'+key,key,null,'','ACR','','Componente obrigatório ausente da biblioteca vigente.');
 }
 else add('ACR:library','Biblioteca ACR',null,'','ACR','',library.state==='AMBIGUOUS'?'Mais de uma tabela compatível na competência.':'Não há tabela compatível cobrindo a competência.');
 // Tax incidence is not present in the library profile. Only structured current declarations are usable.
 for(const scenario of ['ACL','ACR'])for(const code of ['ICMS','PIS','COFINS']){
  const matches=c.captured.parameters.filter((x:any)=>x.scenario===scenario&&x.kind==='TAX'&&x.component_code===code&&x.status==='APPROVED'&&String(x.start_date).slice(0,10)<=period.start&&String(x.end_date).slice(0,10)>=period.end);
  const candidate=matches.length===1?matches[0]:null;
  const p=candidate&&!parameterIssues(candidate,c.captured.parameters).length?candidate:null;
  add(scenario+':tax:'+code,code,p?{rate:p.amount_text,treatment:p.treatment,basis:p.tax_basis}:null,'',''+scenario,p?'Parâmetro '+p.id+' revisão '+p.revision+' · '+p.source:'',p?null:'Incidência e bases precisam de evidência cadastrada; a alíquota da fatura não comprova o cenário comparativo.');
 }
 const management=adjustedContracts(c.captured.management,c.captured.adjustments,c.month).filter((x:any)=>x.organization_id===u.organization_id&&x.customer_id===u.customer_id&&x.status==='ACTIVE'&&String(x.start_date).slice(0,10)<=period.start&&String(x.end_date).slice(0,10)>=period.end),m=management.length===1?management[0]:null;
 let fixed=m&&!m.fee_adjustment_pending?m.fixed_fee_monthly:null;try{if(fixed!==null)feeCents(fixed);}catch{fixed=null;}
 add('fee:fixed','Honorário fixo por unidade',fixed,'BRL','ACL',m?'Contrato de gestão '+m.id+(m.fee_adjustment?' · reajuste '+m.fee_adjustment.id:''):'');
 if(m?.remuneration_model==='HYBRID'){
  let percentage=m.savings_percentage;try{allocationUnits(percentage);}catch{percentage=null;}
  add('fee:percentage','Honorário variável',percentage,'%','ACL','Contrato de gestão '+m.id,'Valor final depende da economia consolidada de todas as unidades.');
  const allocations=c.captured.feeRules.filter((a:any)=>a.contract_id===m.id&&a.month===c.month).sort((a:any,b:any)=>b.version-a.version),a=allocations[0];
  let allocation=a?.allocations??null;try{if(!a?.source||a.fixed_fee_basis!=='PER_UNIT')throw Error();allocateFee('0',allocation);if(!allocation.some((x:any)=>x.consumerUnitId===u.id))throw Error();}catch{allocation=null;}
  add('fee:allocation','Rateio variável',allocation,'','ACL',a?'Rateio '+a.id+' v'+a.version+' · '+a.source:'');
 }
 const s=c.diagnosis.contractSupplierCost;
 add('supplier:contract','Contrato fornecedor',s?.contract?.number??null,'','ACL',s?.contract?'Contrato '+s.contract.id:'');
 add('supplier:price','Preço vigente fornecedor',s?.pricePerMwh??null,'BRL_MWH','ACL',s?.pricePerMwh?'Contrato '+s.contract.id+' · '+s.priceSource:'');
 add('supplier:volume','Volume contratado',s?.contractedMwh??null,'MWh','ACL',s?.contract?'Contrato '+s.contract.id:'');
 add('supplier:tax','Tributos fornecedor',s?.taxTreatment??null,'','ACL',s?.rule?'Regra '+s.rule.id+' v'+s.rule.version+' · '+s.rule.source:'');
 add('supplier:regular','Energia regular proposta',proposedRegularSupplierAmount(s,c.measurements),'BRL','ACL',s?.contract&&s?.rule?'Contrato '+s.contract.id+' · regra '+s.rule.id+' · '+src:'','Proposta do preço vigente e volume faturável; não duplica a NF e não inclui compras extras ou tributos ainda não apurados.');
 for(const r of s?.requirements??[])observations.push(r.message);
 if(!c.ready)observations.push('Identidade, leitura ou conciliação da fatura ainda exige conferência; nenhuma confirmação humana será simulada.');
 for(const r of c.rates)if(r.state==='CONFLICT')observations.push(r.label+': divergência com registro existente.');
 const monthlyConflict=c.input?.status==='DRAFT'&&!!c.monthlyChanges?.length;
 const costConflict=c.cost?.status==='DRAFT'&&c.cip.ready&&!c.cipPresent&&(c.cost.costs?.items??[]).some((i:any)=>i.scenario==='ACL'&&i.category==='OTHER');
 if(monthlyConflict)observations.push('O rascunho mensal existente diverge da nova proposta e foi preservado; conferir a diferença antes de validar.');
 if(costConflict)observations.push('Há custo mensal em rascunho que exige conciliação com a iluminação pública da fatura; nenhum item foi substituído.');
 let measurementWarnings:string[];try{measurementWarnings=measurementIssues(c.measurements,true);}catch{measurementWarnings=['As medições possuem formato inconsistente; conferir a evidência original.'];}
 observations.push(...measurementWarnings);
 const pending=fields.filter(f=>f.state==='PENDING').length,filled=fields.length-pending;
 const sourceConsistent=c.ready&&!c.rates.some((r:any)=>r.state==='CONFLICT')&&!monthlyConflict&&!costConflict&&!measurementWarnings.length;
 const percent=Math.min(sourceConsistent?100:99,fields.length?Math.floor(filled*100/fields.length):0);
 return {fields,observations:[...new Set(observations)],percent,filled,total:fields.length,pending,readyForValidation:pending===0&&sourceConsistent,library:lib?{id:lib.id,version:lib.version}:null,canPublish:false as const};
}
