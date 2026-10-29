import {assertEvidence,decimal,quantity,monthIndex,Observation,Scope} from './consumption-forecast';
import {reportHash} from '../reports/report.projection';

export const ANNUAL_PLANNING_VERSION='annual-weighted-planning/1';
const S=1000000n;
const divide=(n:bigint,d:bigint)=>n<0n?-((-n+d/2n)/d):(n+d/2n)/d;
const daysOf=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
export const planningDifference=(current:string|null,previous:string|null)=>{
 if(current===null||previous===null)return {kwh:null,percent:null};
 const a=quantity(current),b=quantity(previous),difference=a-b;
 return {kwh:decimal(difference),percent:b===0n?null:decimal(divide(difference*100n*S,b))};
};

/** Advisory read model only. A retrospective simulation never uses the target month's actual. */
export function annualPlanning(scope:Scope,observations:Observation[],publications:any[],cutoff:string,origins:Map<string,string>,expansions:any[],calculatedAt:string){
 monthIndex(cutoff);
 if(!Number.isFinite(Date.parse(calculatedAt))||observations.length>36||publications.length>100||expansions.length>100)throw Error('PLANNING_SOURCE_INVALID');
 const actual=new Map<string,Observation>(),kinds=new Map(origins),pending:string[]=[];
 for(const row of observations){
  assertEvidence(scope,row.evidence);monthIndex(row.month);quantity(row.consumptionKwh);
  if(!Number.isInteger(row.billedDays)||row.billedDays<1||row.billedDays>62)throw Error('PLANNING_DAYS_INVALID');
  if(row.month>cutoff)continue;
  if(actual.has(row.month))throw Error('PLANNING_MONTH_DUPLICATE');actual.set(row.month,row);
 }
 const realized=new Map<string,{amount:string;days:number|null;kind:string}>();
 for(const row of actual.values()){const kind=kinds.get(row.month);if(kind==='CCEE_FINAL'||kind==='PUBLISHED_CONSUMPTION')realized.set(row.month,{amount:row.consumptionKwh,days:row.billedDays,kind});}
 const seen=new Set<string>();
 for(const p of publications){
  if(p.organizationId!==undefined&&p.organizationId!==scope.organizationId||p.customerId!==scope.customerId||p.unitId!==scope.unitId||!p.publicationId||!/^[a-f0-9]{64}$/.test(p.sourceHash??'')||!Number.isFinite(Date.parse(p.publishedAt)))throw Error('PLANNING_PUBLICATION_SCOPE');
  monthIndex(p.month);if(seen.has(p.month))throw Error('PLANNING_PUBLICATION_DUPLICATE');seen.add(p.month);if(p.month>cutoff)continue;
  const get=(key:string)=>{const found=p.fields?.filter((f:any)=>f.key===key);if(found?.length!==1)throw Error();return quantity(found[0].value);};
  try{
   const total=get('consumptionTotal');if(get('consumptionPeak')+get('consumptionOffPeak')!==total)throw Error();
   const ds=(p.tariffLines??[]).filter((l:any)=>l.component==='TE').map((l:any)=>l.billedDays);
   const explicit=ds.length===2&&ds.every((d:any)=>typeof d==='string'&&/^[1-9]\d?$/.test(d)&&Number(d)<=62)&&new Set(ds).size===1?Number(ds[0]):null;
   const days=explicit??actual.get(p.month)?.billedDays??null;
   realized.set(p.month,{amount:decimal(total),days,kind:'PUBLISHED_CONSUMPTION'});
   if(!days){actual.delete(p.month);kinds.set(p.month,'PUBLISHED_CONSUMPTION');pending.push(p.month+': consumo publicado disponível; dias pendentes, excluído apenas da média diária.');continue;}
   actual.set(p.month,{month:p.month,consumptionKwh:decimal(total),billedDays:days,evidence:{...scope,id:p.publicationId,revision:1,hash:p.sourceHash,validatedBy:'publication',validatedAt:p.publishedAt}});kinds.set(p.month,'PUBLISHED_CONSUMPTION');
  }catch{actual.delete(p.month);realized.delete(p.month);kinds.delete(p.month);pending.push(p.month+': conferir consumo e dias da publicação.');}
 }
 const eligible=[...actual.values()].sort((a,b)=>a.month.localeCompare(b.month));
 const expansionRows=expansions.filter(e=>{
  const p=e.evidence;
  if(!p||['organizationId','customerId','unitId'].some(k=>p[k]!==scope[k as keyof Scope])||!p.id||!Number.isInteger(p.revision)||p.revision<1||!/^[a-f0-9]{64}$/.test(p.hash??'')||!p.recordedBy||!Number.isFinite(Date.parse(p.recordedAt))||p.justification?.trim().length<20)throw Error('PLANNING_EXPANSION_SCOPE');
  monthIndex(e.startMonth);monthIndex(e.endMonth);quantity(e.monthlyKwh);if(e.endMonth<e.startMonth)throw Error('PLANNING_EXPANSION_PERIOD');
  return e.startMonth>cutoff;
 });
 if(new Set(expansionRows.map(e=>e.evidence.id)).size!==expansionRows.length)throw Error('PLANNING_EXPANSION_DUPLICATE');
 const currentYear=Number(cutoff.slice(0,4)),firstYear=Math.max(currentYear-2,Number(eligible[0]?.month.slice(0,4)??currentYear));
 const years=Array.from({length:currentYear-firstYear+1},(_,i)=>firstYear+i).map(year=>{
  const rows=Array.from({length:12},(_,i)=>{
   const suffix=String(i+1).padStart(2,'0'),month=year+'-'+suffix,previous=actual.get((year-1)+'-'+suffix),current=actual.get(month),kind=kinds.get(month)??'REVIEWED_HISTORY';
   const history=eligible.filter(r=>r.month<month).slice(-12),targetDays=daysOf(month);
   let n=0n,d=0n;history.forEach((r,j)=>{n+=BigInt(j+1)*quantity(r.consumptionKwh);d+=BigInt((j+1)*r.billedDays);});
   const expansion=expansionRows.filter(e=>e.startMonth<=month&&month<=e.endMonth).reduce((sum,e)=>sum+quantity(e.monthlyKwh),0n);
   const simulated=d?decimal(divide(n*BigInt(targetDays),d)+expansion):null;
   const measured=realized.get(month),published=measured?.amount??null;
   const currentDaily=measured?.days?decimal(divide(quantity(measured.amount),BigInt(measured.days))):null,previousDaily=previous?decimal(divide(quantity(previous.consumptionKwh),BigInt(previous.billedDays))):null;
   return {month,previousKwh:previous?.consumptionKwh??null,previousOrigin:previous?kinds.get(previous.month)??'REVIEWED_HISTORY':null,simulatedKwh:simulated,expansionKwh:decimal(expansion),publishedKwh:published,origin:measured?.kind??null,billedDays:measured?.days??null,previousDays:previous?.billedDays??null,projectedDays:targetDays,historyMonths:history.length,historyFrom:history[0]?.month??null,historyTo:history.at(-1)?.month??null,currentDailyKwh:currentDaily,previousDailyKwh:previousDaily,difference:planningDifference(published,previous?.consumptionKwh??null),versusSimulation:planningDifference(published,simulated),dailyDifference:planningDifference(currentDaily,previousDaily)};
  });
  const paired=rows.filter(r=>r.publishedKwh!==null&&r.previousKwh!==null),sum=(items:any[],key:string)=>decimal(items.reduce((n,r)=>n+quantity(r[key]),0n));
  const available=rows.filter(r=>r.publishedKwh!==null||r.simulatedKwh!==null);
  return {year,rows,comparableMonths:paired.length,comparableCurrentKwh:paired.length?sum(paired,'publishedKwh'):null,comparablePreviousKwh:paired.length?sum(paired,'previousKwh'):null,comparableDifference:planningDifference(paired.length?sum(paired,'publishedKwh'):null,paired.length?sum(paired,'previousKwh'):null),estimatedYearKwh:available.length?decimal(available.reduce((n,r)=>n+quantity((r.publishedKwh??r.simulatedKwh)!),0n)):null,estimatedMonths:available.length};
 });
 return {state:eligible.length||realized.size?'AVAILABLE' as const:'SOURCE_PENDING' as const,formulaVersion:ANNUAL_PLANNING_VERSION,cutoff,calculatedAt,years,pending,sourceFingerprint:reportHash({version:ANNUAL_PLANNING_VERSION,scope,cutoff,eligible,realized:[...realized].sort(),kinds:[...kinds].sort(),expansionRows}),notice:'Simulação recalculada no corte informado. Histórico retroativo da fatura não cria fechamento publicado. Pesos 1 a N por recência: soma(peso × kWh) ÷ soma(peso × dias documentados) × dias do mês-alvo. Até 12 meses anteriores elegíveis; lacunas não são zero. Histórico curto indica referência preliminar, sem comprovar sazonalidade.'};
}
