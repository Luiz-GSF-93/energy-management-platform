import {measurementIssues,measurementKeys} from './monthly-inputs';
import type {Finding} from './preparation';
export function prepareMeasurements(unit:any,month:string,rows:any[]){
 const findings:Finding[]=[];
 const add=(code:string,message:string)=>findings.push({code,section:'Medições',severity:'BLOCKER',message});
 const scoped=rows.filter(r=>r.organization_id===unit.organization_id&&r.customer_id===unit.customer_id&&r.consumer_unit_id===unit.id&&r.month===month).sort((a,b)=>b.version-a.version);
 const drafts=scoped.filter(r=>r.status==='DRAFT'),validated=scoped.filter(r=>r.status==='VALIDATED'),latest=validated[0];
 const summary={status:!scoped.length?'MISSING':drafts.length?'DRAFT_PENDING':latest?'VALIDATED':'INVALID',draftCount:drafts.length,validatedCount:validated.length,validatedVersion:latest?{id:latest.id,version:latest.version,revision:latest.revision,validatedAt:latest.validated_at,source:latest.source_reference,measurements:latest.measurements,billedDemand:latest.billed_demand??null}:null};
 if(!scoped.length)add('MEASUREMENTS_MISSING','Cadastre e valide as medições da unidade nesta competência em Dados mensais.');
 if(drafts.length)add('MEASUREMENTS_DRAFT',latest?'Existe uma correção em rascunho. Revise e valide a nova versão antes de apurar.':'As medições estão em rascunho. Solicite a validação por Gestor ou Administrador.');
 const versions=scoped.map(r=>r.version);
 if(scoped.some(r=>!['DRAFT','VALIDATED'].includes(r.status)||!Number.isInteger(r.version)||r.version<1)||new Set(versions).size!==versions.length||drafts.length>1||drafts.some(r=>latest&&r.version<=latest.version))add('MEASUREMENTS_HISTORY','O histórico das medições apresenta inconsistência. Solicite revisão administrativa.');
 if(!latest){if(scoped.length&&!drafts.length)add('MEASUREMENTS_UNVALIDATED','Não há versão validada das medições.');return {...summary,findings};}
 const m=latest.measurements;
 if(!m||typeof m!=='object'||Array.isArray(m)||measurementKeys.some(k=>!(k in m)||(m[k]!==null&&(typeof m[k]!=='string'||!/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/.test(m[k]))))||Object.keys(m).some(k=>!measurementKeys.includes(k as any))){add('MEASUREMENTS_INVALID','A versão validada contém medições inválidas. Registre uma versão corrigida.');return {...summary,status:'INVALID',validatedVersion:null,findings};}
 for(const message of measurementIssues(m,true))add('MEASUREMENTS_INCONSISTENT',message);
 if(!latest.validated_at||!latest.validated_by||!latest.source_reference?.trim())add('MEASUREMENTS_EVIDENCE','A versão não possui validação ou fonte identificada. Solicite revisão.');
 const contextKeys=['distributor','tariff_group','tariff_subgroup','tariff_modality','state','free_market'];
 if(!latest.unit_context||contextKeys.some(k=>(latest.unit_context[k]??null)!==(unit[k]??null)))add('MEASUREMENTS_CONTEXT','O cadastro elétrico mudou desde o registro das medições. Confira-o e valide uma nova versão.');
 if(['BLUE','GREEN','WHITE'].includes(unit.tariff_modality)&&(m.consumptionPeak==null||m.consumptionOffPeak==null))add('MEASUREMENTS_BANDS','Informe o consumo de ponta e fora ponta para a modalidade tarifária cadastrada.');
 if(unit.tariff_group==='A'){
  if(unit.tariff_modality==='BLUE'&&(m.demandPeak==null||m.demandOffPeak==null))add('MEASUREMENTS_DEMAND','A modalidade azul exige demanda medida de ponta e fora ponta.');
  else if(unit.tariff_modality==='GREEN'&&m.demandSingle==null)add('MEASUREMENTS_DEMAND','A modalidade verde exige demanda medida única.');
 }
 return {...summary,findings};
}
