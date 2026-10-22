import {parameterIssues} from '../contracts/services/parameter-issues';
import {measurementIssues} from '../contracts/services/monthly-inputs';
/** Classifies preparation work without editing any financial finding or approval gate. */
export function preparationDiagnostics(c:any){
 const roots=new Map<string,any>();
 for(const f of c.diagnosis.findings??[]){
  let review=f.severity==='REVIEW',key=f.code,label=f.message;
  const match=/^(TARIFF_MISSING|TAX_MISSING):(ACL|ACR)(?::(ICMS|PIS|COFINS))?$/.exec(f.code);
  if(match){const candidates=c.captured.parameters.filter((p:any)=>p.organization_id===c.unit.organization_id&&p.consumer_unit_id===c.unit.id&&p.status==='DRAFT'&&p.scenario===match[2]&&p.kind===(match[1]==='TAX_MISSING'?'TAX':'TARIFF')&&(!match[3]||p.component_code===match[3])&&String(p.start_date).slice(0,10)<=c.period.start&&String(p.end_date).slice(0,10)>=c.period.end);
   if(candidates.length&&candidates.every((p:any)=>!parameterIssues(p,c.captured.parameters).length)){review=true;key='PARAMETERS:'+match[2];label=match[2]+': parâmetros preenchidos em rascunho; conferir e aprovar pelo fluxo existente.';}
  }
  if(f.code==='MEASUREMENTS_DRAFT'&&c.input?.status==='DRAFT'&&!c.monthlyChanges?.length){try{if(!measurementIssues(c.measurements,true).length){review=true;label='Medições preenchidas em rascunho; conferir e validar.';}}catch{/* preserve source issue */}}
  if(f.code==='COSTS_DRAFT'&&c.cost?.status==='DRAFT'&&c.cost.source_reference?.trim()){review=true;label='Custos em rascunho; revisão financeira pendente. Valores não são considerados aprovados.';}
  const rootKey=(review?'REVIEW:':'SOURCE:')+key,old=roots.get(rootKey);
  if(old)old.findings.push(f);else roots.set(rootKey,{key:rootKey,kind:review?'REVIEW':'SOURCE',label,findings:[f]});
 }
 const list=[...roots.values()];
 return {roots:list,sourceCauses:list.filter(r=>r.kind==='SOURCE').length,reviewCauses:list.filter(r=>r.kind==='REVIEW').length,financialCounts:c.diagnosis.counts,financialApproval:false};
}
