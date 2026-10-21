import {createHash} from 'node:crypto';

export const INDEX_MEMORY_FLAG='CONTRACT_INDEX_MEMORY_ENABLED';
export type IndexMemoryParameters={month:string;basePrice:string;baseDate:string;firstAdjustment:string;frequencyMonths:number;index:'IPCA';sourceDocumentId:string|null;sourceNote:string};
export const indexMemoryHash=(v:unknown)=>{
 const canonical=(x:any):any=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
 return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
};
const monthPattern=/^(20|21)\d{2}-(0[1-9]|1[0-2])$/;
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const serial=(m:string)=>Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
const formatMonth=(n:number)=>String(Math.floor(n/12))+'-'+String(n%12+1).padStart(2,'0');
export function indexMemoryParameters(v:any):IndexMemoryParameters{
 if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!=='baseDate,basePrice,firstAdjustment,frequencyMonths,index,month,sourceDocumentId,sourceNote'||!monthPattern.test(v.month)||typeof v.basePrice!=='string'||!/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(v.basePrice)||typeof v.baseDate!=='string'||typeof v.firstAdjustment!=='string'||!monthPattern.test(v.baseDate.slice(0,7))||v.baseDate!==v.baseDate.slice(0,7)+'-01'||!monthPattern.test(v.firstAdjustment.slice(0,7))||v.firstAdjustment!==v.firstAdjustment.slice(0,7)+'-01'||v.firstAdjustment<=v.baseDate||![1,3,6,12].includes(v.frequencyMonths)||v.index!=='IPCA'||!(v.sourceDocumentId===null||uuid(v.sourceDocumentId))||typeof v.sourceNote!=='string'||v.sourceNote.trim().length<20||v.sourceNote.length>1000)throw Error('Confira preço-base, índice, datas, periodicidade e fonte contratual.');
 return {...v,sourceNote:v.sourceNote.trim()};
}
export function indexMemoryPlan(input:IndexMemoryParameters){
 const p=indexMemoryParameters(input),target=serial(p.month),first=serial(p.firstAdjustment.slice(0,7)),due=target>=first;
 const anniversary=due?first+Math.floor((target-first)/p.frequencyMonths)*p.frequencyMonths:null;
 const baseMonth=formatMonth(serial(p.baseDate.slice(0,7))-1),referenceMonth=anniversary===null?null:formatMonth(anniversary-1);
 const periods=[...new Set([baseMonth,referenceMonth].filter((m):m is string=>!!m))].sort();
 const url=due?'https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/'+periods.map(m=>m.replace('-','')).join(',')+'?formato=json':null;
 return {version:'contract-index-1',index:'IPCA/IBGE',table:'1737',variable:'2266',territory:'Brasil',due,baseMonth,referenceMonth,anniversary:anniversary===null?null:formatMonth(anniversary)+'-01',periods,url,host:'apisidra.ibge.gov.br',requests:due?1:0,formula:'PT × NR / NB',outbound:due?{table:'1737',variable:'2266',territory:'Brasil',periods}:null,customerDataSent:false,automaticFinancialApproval:false};
}
const decimal=(s:unknown)=>{if(typeof s!=='string'||!/^(0|[1-9]\d{0,11})(\.\d{1,15})?$/.test(s))throw Error('Número-índice inválido.');const [w,f='']=s.split('.');return BigInt(w)*10n**15n+BigInt(f.padEnd(15,'0'));};
const fixed=(n:bigint,p:number)=>{const s=n.toString().padStart(p+1,'0');return s.slice(0,-p)+'.'+s.slice(-p);};
const rounded=(n:bigint,d:bigint)=>{if(d<=0n)throw Error('Número-índice de base inválido.');return (n+d/2n)/d;};
export function parseOfficialIpca(value:unknown,plan:ReturnType<typeof indexMemoryPlan>){
 if(!Array.isArray(value)||value.length!==plan.periods.length+1||value[0]?.V!=='Valor')throw Error('Resposta oficial incompleta ou não reconhecida.');
 const rows=value.slice(1),result:Record<string,string>={};
 for(const r of rows){if(!r||r.NC!=='1'||r.D1C!=='1'||r.D2C!=='2266'||r.MC!=='30'||typeof r.D3C!=='string'||!/^(19|20|21)\d{4}$/.test(r.D3C))throw Error('Série, território ou unidade oficial divergente.');const month=r.D3C.slice(0,4)+'-'+r.D3C.slice(4);if(!plan.periods.includes(month)||month in result||decimal(r.V)<=0n)throw Error('Períodos oficiais divergentes ou duplicados.');result[month]=r.V;}
 if(plan.periods.some(m=>!(m in result)))throw Error('A fonte não retornou todos os meses exigidos.');return result;
}
export function calculateIndexMemory(p:IndexMemoryParameters,indices:Record<string,string>,registeredPrice:unknown){
 const plan=indexMemoryPlan(p),base=decimal(p.basePrice);let nb:bigint|null=null,nr:bigint|null=null;
 if(plan.due){nb=decimal(indices[plan.baseMonth]);nr=decimal(indices[plan.referenceMonth!]);if(nb<=0n||nr<=0n)throw Error('Índices oficiais incompletos.');}
 const price=plan.due?rounded(base*nr!,nb!):base;
 const pricePerMwh=fixed(plan.due?rounded(base*nr!,nb!*10n**9n):rounded(base,10n**9n),6),factor=plan.due?fixed(rounded(nr!*10n**12n,nb!),12):'1.000000000000';
 const percent=plan.due?(()=>{const diff=nr!-nb!,n=rounded((diff<0n?-diff:diff)*100n*10n**9n,nb!);return (diff<0n?'-':'')+fixed(n,9);})():'0.000000000';
 let difference:string|null=null;try{const old=decimal(String(registeredPrice)),diff=price-old;difference=(diff<0n?'-':'')+fixed(rounded(diff<0n?-diff:diff,10n**9n),6);}catch{/* an unproved registered value is not zero */}
 return {format:'contract-index-memory-1',plan,basePrice:p.basePrice,indices,factor,accumulatedPercent:percent,pricePerMwh,registeredPrice:registeredPrice??null,difference,rounding:'Preço proposto com seis casas decimais; razão calculada antes do arredondamento.',sourceNote:p.sourceNote,automaticFinancialApproval:false,canApply:false,documentCharge:0};
}
