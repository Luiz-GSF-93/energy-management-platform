import {calculateConsumptionForecast,quantity,decimal,Observation} from './consumption-forecast';
import {applyClimateForecast} from './climate-forecast';
import {applyClimateCycle} from './climate-cycle';
import {reportHash} from '../reports/report.projection';
import {historicalContractingScenario} from './historical-contracting';

/** Recalculates a read-only planning view. Never mutates a published forecast or closing. */
export function publicationPlanning(body:any,publications:any[],calculatedAt:string,weatherRequest?:any){
 const scope={organizationId:body.organizationId,customerId:body.customerId,unitId:body.unitId};
 if(!Array.isArray(body.actual)||!Array.isArray(body.expansions)||!Array.isArray(publications))throw Error('Histórico aprovado indisponível.');
 const observations=new Map<string,Observation>(body.actual.map((a:any)=>[a.month,{...a,evidence:{...a.evidence}}]));
 const seen=new Set<string>(),sources:any[]=[],pending:string[]=[];
 for(const p of [...publications].sort((a,b)=>String(a.month).localeCompare(String(b.month)))){
  if(p.customerId!==scope.customerId||p.unitId!==scope.unitId||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(p.month)||!/^([a-f0-9]{64})$/.test(p.sourceHash??'')||typeof p.publicationId!=='string'||!p.publicationId||!Number.isFinite(Date.parse(p.publishedAt??'')))throw Error('Escopo ou integridade da publicação divergente.');
  if(seen.has(p.month))throw Error('Mais de uma publicação vigente para a competência.');seen.add(p.month);
  const entries=Array.isArray(p.fields)?p.fields:[];
  const get=(key:string)=>{const found=entries.filter((f:any)=>f.key===key);if(found.length!==1)throw Error('Medição publicada ambígua.');return found[0].value;};
  let consumption:string;
  try{const total=get('consumptionTotal');if(quantity(get('consumptionPeak'))+quantity(get('consumptionOffPeak'))!==quantity(total))throw Error();consumption=decimal(quantity(total));}catch{pending.push(p.month+': medição publicada exige conciliação.');continue;}
  const lines=Array.isArray(p.tariffLines)?p.tariffLines:[],dayValues=lines.filter((l:any)=>l.component==='TE').map((l:any)=>l.billedDays);
  const explicit=dayValues.length===2&&dayValues.every((v:any)=>typeof v==='string'&&/^[1-9]\d?$/.test(v)&&Number(v)<=62)&&new Set(dayValues).size===1?Number(dayValues[0]):null;
  const historical=observations.get(p.month),days=explicit??historical?.billedDays;
  if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>62){pending.push(p.month+': informe os dias documentados do ciclo para atualizar o planejamento.');continue;}
  observations.set(p.month,{month:p.month,consumptionKwh:consumption,billedDays:days!,evidence:{...scope,id:p.publicationId,revision:1,hash:p.sourceHash,validatedBy:'publicação:'+p.publicationId,validatedAt:p.publishedAt}});
  sources.push({month:p.month,publicationId:p.publicationId,sourceHash:p.sourceHash,daysBasis:explicit!==null?'PUBLISHED_READING_PERIOD':'APPROVED_HISTORY_SAME_MONTH'});
 }
 if(pending.length)return {state:'SOURCE_PENDING' as const,pending,sources};
 const sorted=[...observations.values()].sort((a,b)=>a.month.localeCompare(b.month)).slice(-36),asOfMonth=sorted.at(-1)?.month;
 if(!asOfMonth)throw Error('Histórico indisponível.');
 const input={...scope,asOfMonth,observations:sorted,expansions:body.expansions};
 const base=calculateConsumptionForecast(input);let current:any={...base,weatherStatus:'NOT_REQUESTED',climateAssessment:null};
 // Reuse only a compatible, previously authorized weather snapshot. No network calls.
 if(body.weather&&weatherRequest&&asOfMonth===body.asOfMonth){
  try{const assessed=weatherRequest.assessment?applyClimateCycle(input,base,body.weather,weatherRequest):applyClimateForecast(input,base,body.weather);current={...current,...assessed,weatherStatus:assessed.weatherApplied?'CLIMATE_SCENARIO_APPLIED':'HISTORY_COLLECTED_NOT_APPLIED'};}catch{current.qualifications.push('Memória climática incompatível com a atualização; planejamento sem ajuste climático.');}
 }
 const contractingScenario=historicalContractingScenario(scope,current.actual,current.future,asOfMonth,calculatedAt);
 return {state:'AVAILABLE' as const,pending:[],sources,sourceFingerprint:reportHash({baseForecastHash:reportHash(body),input,sources,weatherStatus:current.weatherStatus,contractingScenarioFormula:contractingScenario.formulaVersion}),current:{...current,contractingScenario,calculatedAt,asOfMonth}};
}
