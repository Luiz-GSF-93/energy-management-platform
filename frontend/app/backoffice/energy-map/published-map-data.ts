export type PublishedAmounts={acr:string;aclBeforeFees:string;totalFees:string;aclAfterFees:string;savingsBeforeFees:string;savingsAfterFees:string;savingsPercent:string|null};
export type PublishedUnitRow={id:string;unitId:string;customerId:string;month:string;version:number;payloadHash:string;amounts:PublishedAmounts};
export type PublishedInvoice={groupId:string;unitId:string;month:string;version:number;payloadHash:string;findings:{code:string;message:string}[];warnings:string[];reservations:string[]};
export type MapPublication={organizationId:string;mode:string;primary:{organizationId:string;period:{from:string;to:string;customerId:string;unitId:string};totals:PublishedAmounts|null;unitRows:PublishedUnitRow[];invoices:PublishedInvoice[];coverage:{publishedMonths:number;requestedMonths:number;missingMonths:string[];unitBreakdownAvailable:boolean}}};
export function publishedPeriod(from:string,to:string){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(to))return false;
 const month=(v:string)=>Number(v.slice(0,4))*12+Number(v.slice(5));const length=month(to)-month(from)+1;return length>=1&&length<=12;
}
const signed=/^-?(0|[1-9]\d{0,14})\.\d{2}$/;
function amounts(a:PublishedAmounts){return !!a&&['acr','aclBeforeFees','totalFees','aclAfterFees','savingsBeforeFees','savingsAfterFees'].every(k=>typeof a[k as keyof PublishedAmounts]==='string'&&signed.test(a[k as keyof PublishedAmounts] as string))&&(a.savingsPercent===null||signed.test(a.savingsPercent));}
export function validateMapPublication(r:MapPublication,scope:{organizationId:string;customerId:string;id:string},from:string,to:string){
 const p=r?.primary,c=p?.coverage;
 if(r?.mode!=='PUBLISHED_REPORTS'||r.organizationId!==scope.organizationId||p?.organizationId!==scope.organizationId||p.period?.customerId!==scope.customerId||p.period.unitId!==scope.id||p.period.from!==from||p.period.to!==to||!Array.isArray(p.unitRows)||!Array.isArray(p.invoices)||!c||!Number.isSafeInteger(c.publishedMonths)||!Number.isSafeInteger(c.requestedMonths)||c.requestedMonths<1||c.requestedMonths>12||c.publishedMonths<0||c.publishedMonths>c.requestedMonths||!Array.isArray(c.missingMonths)||c.missingMonths.some(m=>typeof m!=='string'||m<from||m>to)||c.missingMonths.length!==c.requestedMonths-c.publishedMonths||c.unitBreakdownAvailable!==true||p.totals!==null&&!amounts(p.totals))throw Error('O escopo ou a publicação mudou. Consulte novamente.');
 const versions=new Set<string>(),months=new Set<string>();
 for(const row of p.unitRows){if(row.unitId!==scope.id||row.customerId!==scope.customerId||typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.version)||row.version<1||!/^[a-f0-9]{64}$/.test(row.payloadHash)||typeof row.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)||row.month<from||row.month>to||!amounts(row.amounts)||months.has(row.month))throw Error('Origem publicada inconsistente.');months.add(row.month);versions.add(JSON.stringify([row.id,row.month,row.version,row.payloadHash]));}
 if(months.size!==c.publishedMonths||(p.totals===null)!==(p.unitRows.length===0))throw Error('Cobertura publicada inconsistente.');
 for(const i of p.invoices)if(i.unitId!==scope.id||!versions.has(JSON.stringify([i.groupId,i.month,i.version,i.payloadHash]))||!Array.isArray(i.findings)||i.findings.some(f=>typeof f.code!=='string'||typeof f.message!=='string')||!Array.isArray(i.warnings)||!Array.isArray(i.reservations)||[...i.warnings,...i.reservations].some(v=>typeof v!=='string'))throw Error('Alerta sem origem publicada.');
 return p;
}
export function publishedAlerts(p:MapPublication['primary']){
 const alerts:{message:string;month:string;version:number;hash:string;groupId:string}[]=[];
 for(const row of p.unitRows)if(row.amounts.savingsAfterFees.startsWith('-')&&row.amounts.savingsAfterFees!=='-0.00')alerts.push({message:'Economia negativa após honorários: '+publishedMoney(row.amounts.savingsAfterFees),month:row.month,version:row.version,hash:row.payloadHash,groupId:row.id});
 for(const i of p.invoices)for(const message of [...i.findings.map(f=>f.code+' · '+f.message),...i.warnings,...i.reservations])alerts.push({message,month:i.month,version:i.version,hash:i.payloadHash,groupId:i.groupId});
 return alerts;
}
export function publishedMoney(v:string){const [whole,fraction]=v.split('.');return 'R$ '+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+fraction;}

// The backend already aggregates exact published cents; use its signed percentage unchanged.
export function economyScore(p:MapPublication['primary']){
 return {method:'PUBLISHED_ECONOMY_AFTER_FEES_V1',percent:p.totals?.savingsPercent??null,from:p.period.from,to:p.period.to,coverage:p.coverage,sources:p.unitRows.map(r=>({groupId:r.id,month:r.month,version:r.version,payloadHash:r.payloadHash}))};
}
