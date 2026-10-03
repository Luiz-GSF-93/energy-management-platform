import {InternalServerErrorException,BadRequestException} from '@nestjs/common';
import {aggregate,cents,publishedFinancialSummary} from './published-financial-summary';
import {feeMoney} from './management-fee';
import {PublishedFinancialQueryDto} from '../dto/financial-settlements.dto';
const fields=['acr','aclBeforeFees','totalFees','aclAfterFees','savingsBeforeFees','savingsAfterFees'] as const;
function unitAmounts(u:any){
 const values={acr:u.acr,aclBeforeFees:u.aclBeforeFees,totalFees:u.totalFees,aclAfterFees:u.aclAfterFees,savingsBeforeFees:feeMoney(cents(u.acr)-cents(u.aclBeforeFees)),savingsAfterFees:u.savingsAfterFees,savingsPercent:null};
 const amount=aggregate([values])!;
 if(cents(amount.aclBeforeFees)+cents(amount.totalFees)!==cents(amount.aclAfterFees)||cents(amount.acr)-cents(amount.aclAfterFees)!==cents(amount.savingsAfterFees,true))throw new InternalServerErrorException('Rateio publicado inconsistente.');
 return amount;
}
const share=(value:bigint,total:bigint)=>total>0n?feeMoney((value*10000n+total/2n)/total):'0.00';
export function financialAnalytics(org:string,period:PublishedFinancialQueryDto,pubs:any[],unitId?:string){
 const availableUnits=new Map<string,{id:string;name:string;customerId:string}>(),unitRows:any[]=[],invoices:any[]=[],partial:string[]=[];
 for(const p of pubs)for(const u of p.financial.units)availableUnits.set(u.id,{id:u.id,name:u.name||u.id,customerId:p.meta.customerId});
 const active=unitId?pubs.filter(p=>p.financial.units.some((u:any)=>u.id===unitId)):pubs,base=publishedFinancialSummary(org,period,active);
 for(const p of active){
  const groupUnits:any[]=[];
  for(const u of p.financial.units){
   availableUnits.set(u.id,{id:u.id,name:u.name||u.id,customerId:p.meta.customerId});
   if(fields.filter(k=>k!=='savingsBeforeFees').some(k=>typeof u[k]!=='string')){partial.push(p.meta.id);continue;}
   groupUnits.push({id:p.meta.id,unitId:u.id,unitName:u.name,customerId:p.meta.customerId,customerName:p.customerName,month:p.meta.month,version:p.meta.version,payloadHash:p.meta.payloadHash,amounts:unitAmounts(u)});
  }
  if(groupUnits.length&&groupUnits.length!==p.financial.units.length)throw new InternalServerErrorException('Rateio parcialmente capturado. Nenhum total parcial foi emitido.');
  if(groupUnits.length){const sums=aggregate(groupUnits.map(u=>u.amounts))!;for(const key of fields)if(sums[key]!==p.financial[key])throw new InternalServerErrorException('A soma das unidades diverge do consolidado publicado.');unitRows.push(...groupUnits);}
  for(const u of p.financial.units){if(unitId&&u.id!==unitId)continue;const prep=p.preparations?.[u.id],composition=prep?.operationalComposition;
   const scenarios=Array.isArray(composition?.scenarios)?composition.scenarios.map((s:any)=>({scenario:s.scenario,status:s.status,distributor:s.distributor,supplier:s.supplier,additional:s.additional,taxes:s.taxes,subtotal:s.subtotal,entries:s.entries,invoiceReconciliation:s.invoiceReconciliation??null})):null;
   if(scenarios){for(const s of scenarios){if(!['ACL','ACR'].includes(s.scenario)||s.status!=='AVAILABLE'||!Array.isArray(s.entries))throw new InternalServerErrorException('Componentes publicados indisponíveis.');const subtotal=['distributor','supplier','additional','taxes'].reduce((n,k)=>n+cents(s[k]),0n);if(subtotal!==cents(s.subtotal))throw new InternalServerErrorException('Componentes publicados inconsistentes.');for(const [key,group] of [['distributor','DISTRIBUTOR'],['supplier','SUPPLIER'],['additional','ADDITIONAL'],['taxes','TAX']])if(s.entries.filter((e:any)=>e.group===group).reduce((n:bigint,e:any)=>n+cents(e.amount,true),0n)!==cents(s[key]))throw new InternalServerErrorException('Rubricas não conciliam com o cenário publicado.');}}
   invoices.push({groupId:p.meta.id,payloadHash:p.meta.payloadHash,version:p.meta.version,month:p.meta.month,unitId:u.id,unitName:u.name,customerName:p.customerName,measurements:prep?.measurements?.validatedVersion??null,scenarios,findings:prep?.findings?.filter((f:any)=>f.severity==='REVIEW')??[],warnings:composition?.qualifications??[],reservations:p.reservations});
  }
 }
 if(unitId&&partial.length)throw new BadRequestException('Esta versão não contém rateio completo por unidade. Consulte o consolidado.');
 const selected=unitId?unitRows.filter(r=>r.unitId===unitId):unitRows;
 const months=base.months.map(m=>({...m,totals:unitId?aggregate(selected.filter(r=>r.month===m.month).map(r=>r.amounts)):m.totals}));
 let cumulative:any[]=[];
 const evolution=months.map(m=>{if(!m.totals)return {...m,cumulative:null};cumulative.push(m.totals);return {...m,cumulative:aggregate(cumulative)!.savingsAfterFees};});
 const totals=unitId?aggregate(selected.map(r=>r.amounts)):base.totals;
 const abs=(n:bigint)=>n<0n?-n:n;
 const max=evolution.reduce((n,m)=>m.totals?[m.totals.acr,m.totals.aclAfterFees,m.totals.savingsAfterFees,m.cumulative!].reduce((a,v)=>a>abs(cents(v,true))?a:abs(cents(v,true)),n):n,0n);
 const charts=evolution.map(m=>({...m,widths:m.totals?{acr:share(cents(m.totals.acr),max),acl:share(cents(m.totals.aclAfterFees),max),savings:share(abs(cents(m.totals.savingsAfterFees,true)),max),cumulative:share(abs(cents(m.cumulative!,true)),max)}:null}));
 const byUnit=partial.length?null:[...availableUnits.values()].filter(u=>!unitId||u.id===unitId).map(u=>({...u,publicationCount:unitRows.filter(r=>r.unitId===u.id).length,amounts:aggregate(unitRows.filter(r=>r.unitId===u.id).map(r=>r.amounts))}));
 const labels:Record<string,string>={distributor:'Distribuidora',supplier:'Fornecedor',additional:'Encargos adicionais',taxes:'Tributos adicionais',fees:'Honorários'};
 const components:Record<string,bigint>={distributor:0n,supplier:0n,additional:0n,taxes:0n,fees:0n};let componentAvailable=invoices.length>0;
 for(const invoice of invoices){const s=invoice.scenarios?.find((s:any)=>s.scenario==='ACL'),unit=unitRows.find(u=>u.id===invoice.groupId&&u.unitId===invoice.unitId);if(!s||!unit){componentAvailable=false;continue;}for(const key of ['distributor','supplier','additional','taxes'])components[key]+=cents(s[key]);components.fees+=cents(unit.amounts.totalFees);}
 if(componentAvailable&&totals&&Object.values(components).reduce((a,b)=>a+b,0n)!==cents(totals.aclAfterFees))throw new InternalServerErrorException('Composição não conserva o total publicado.');
 let offset=0;const composition=componentAvailable&&totals?Object.entries(components).map(([key,value])=>{const percent=share(value,cents(totals.aclAfterFees)),segment={key,label:labels[key],amount:feeMoney(value),percent,offset:String(offset)};offset+=Number(percent);return segment;}):null;
 return {organizationId:org,period:{...base.period,unitId:unitId??null},updatedAt:base.updatedAt,totals,publicationCount:unitId?selected.length:base.publicationCount,months:charts,units:[...availableUnits.values()],byUnit,unitRows:selected,invoices,composition,publications:base.rows,coverage:{publishedMonths:months.filter(m=>m.totals).length,requestedMonths:months.length,missingMonths:months.filter(m=>!m.totals).map(m=>m.month),unitBreakdownAvailable:!partial.length},roi:null,annualProjection:null,unavailable:['ROI: investimento e metodologia não definidos.','Projeção anual: metodologia ainda não definida.','CCEE: sem componente identificado separadamente nesta publicação.'],disclosure:'Resultados das últimas versões publicadas. Acumulado considera somente meses publicados; lacunas não representam zero. ACL × ACR é comparação preservada no motor, não uma nova simulação. Honorários e tributos embutidos não são cobrados novamente.'};
}
export function compareFinancialAnalytics(a:ReturnType<typeof financialAnalytics>,b:ReturnType<typeof financialAnalytics>){
 const delta=a.totals&&b.totals?Object.fromEntries(fields.map(k=>[k,feeMoney(cents(a.totals![k],true)-cents(b.totals![k],true))])):null;
 const unitsA=new Set(a.invoices.map(r=>r.unitId)),unitsB=new Set(b.invoices.map(r=>r.unitId));
 return {delta,direction:'A_MINUS_B',sameDuration:a.coverage.requestedMonths===b.coverage.requestedMonths,sameUnits:unitsA.size===unitsB.size&&[...unitsA].every(id=>unitsB.has(id)),completeCoverage:a.coverage.publishedMonths===a.coverage.requestedMonths&&b.coverage.publishedMonths===b.coverage.requestedMonths,warning:'Diferença A − B dos resultados publicados. Confira duração, unidades e cobertura de ambos os períodos; valores ausentes não são zero. Não normaliza consumo nem presume cenários hipotéticos.'};
}
