import {createHash} from 'node:crypto';
export const ANEEL_FLAG_PARENT='https://www.gov.br/aneel/pt-br/assuntos/tarifas/bandeiras-tarifarias';
const root='https://dadosabertos.aneel.gov.br/dataset/7f43a020-6dc5-44b8-80b4-d97eaa94436c/resource/';
export const ANEEL_FLAG_URLS=Object.freeze([root+'0591b8f6-fe54-437b-b72b-1aa2efd46e42/download/bandeira-tarifaria-acionamento.csv',root+'5879ca80-b3bd-45b1-a135-d9b77c1d5b36/download/bandeira-tarifaria-adicional.csv']);
export const flagHash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const normal=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
export function flagColor(value:string){const n=normal(value);return ({VERDE:'VERDE',AMARELA:'AMARELA','VERMELHA 1':'VERMELHA 1','VERMELHA 2':'VERMELHA 2','VERMELHA P1':'VERMELHA 1','VERMELHA P2':'VERMELHA 2','VERMELHA PATAMAR 1':'VERMELHA 1','VERMELHA PATAMAR 2':'VERMELHA 2','ESCASSEZ HIDRICA':'ESCASSEZ HIDRICA'} as Record<string,string>)[n]??null;}
function csv(buffer:Buffer,required:string[]){
 if(buffer.length>2_000_000)throw Error('SOURCE_TOO_LARGE');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{text=new TextDecoder('windows-1252',{fatal:true}).decode(buffer);}
 text=text.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell!=='')throw Error('INVALID_CSV');else quoted=!quoted;}else if(!quoted&&(c===';'||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==';'){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()))rows.push(row);row=[];}}else cell+=c;if(cell.length>4000||rows.length>5000)throw Error('INVALID_CSV');}
 if(quoted)throw Error('INVALID_CSV');if(cell||row.length){row.push(cell);if(row.some(x=>x.trim()))rows.push(row);}
 const header=rows.shift();if(!header||header.length!==required.length||required.some(x=>!header.includes(x))||new Set(header).size!==header.length)throw Error('SOURCE_SCHEMA_CHANGED');
 return rows.map(r=>{if(r.length!==header.length)throw Error('INVALID_CSV');return Object.fromEntries(header.map((h,i)=>[h,r[i].trim()]));});
}
function date(s:string){if(!/^20\d\d-\d\d-\d\d$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('INVALID_SOURCE_DATE');return s;}
function micro(s:string){if(!/^(?:\d{1,5})?(?:[,.]\d{1,6})?$/.test(s)||!s)throw Error('INVALID_SOURCE_RATE');const [a,b='']=s.replace(',','.').split('.');const n=BigInt(a||'0')*1000000n+BigInt(b.padEnd(6,'0'));if(n>1000_000000n)throw Error('INVALID_SOURCE_RATE');return n;}
function rate(n:bigint){if(n%1000n!==0n)throw Error('UNSUPPORTED_SOURCE_PRECISION');const v=(n/1000n).toString().padStart(7,'0');return v.slice(0,-6)+'.'+v.slice(-6);}
export type FlagFeedRow={month:string;color:string;rate:string;state:'VALIDATED'|'REVIEW_REQUIRED';reason:string;generationDate:string;tariffDate:string|null;resolution:string|null;activation:Record<string,string>;additional:Record<string,string>|null};
export function parseFlagFeeds(activation:Buffer,additional:Buffer,today:string):FlagFeedRow[]{
 date(today);const a=csv(activation,['DatGeracaoConjuntoDados','DatCompetencia','NomBandeiraAcionada','VlrAdicionalBandeira']),b=csv(additional,['DatGeracaoConjuntoDados','DscResolucao','DatVigencia','NomBandeiraAcionada','VlrAdicionalBandeiraRSMWh']);
 const tariffs=b.map(r=>({row:r,date:date(r.DatVigencia),color:flagColor(r.NomBandeiraAcionada),amount:micro(r.VlrAdicionalBandeiraRSMWh)}));
 if(tariffs.some(t=>!t.color||!t.row.DscResolucao||date(t.row.DatGeracaoConjuntoDados)>today))throw Error('INVALID_TARIFF_SOURCE');
 const max=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),1));const maxMonth=max.toISOString().slice(0,7),seen=new Set<string>();
 return a.flatMap<FlagFeedRow>(row=>{
  const day=date(row.DatCompetencia),month=day.slice(0,7),generation=date(row.DatGeracaoConjuntoDados),color=flagColor(row.NomBandeiraAcionada),amount=micro(row.VlrAdicionalBandeira);
  if(!day.endsWith('-01')||!color||generation>today||month>maxMonth||seen.has(month))throw Error('AMBIGUOUS_MONTHLY_SOURCE');seen.add(month);
  if(month<'2024-04')return [];
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const applicable=tariffs.filter(t=>t.color===color&&t.date<=day).sort((x,y)=>y.date.localeCompare(x.date)),chosen=applicable[0];
  let reason='';if(color==='VERDE'){if(amount!==0n)reason='Bandeira verde com adicional diferente de zero.';}else if(!chosen||tariffs.some(t=>t.color===color&&t.date>day&&t.date<=end)||applicable.filter(t=>t.date===chosen?.date).length!==1)reason='Vigência do adicional não cobre o mês inteiro de forma única.';else if(chosen.amount!==amount)reason='Acionamento e adicional oficial apresentam valores divergentes.';
  return [{month,color,rate:rate(amount),state:reason?'REVIEW_REQUIRED':'VALIDATED',reason,generationDate:generation,tariffDate:chosen?.date??null,resolution:chosen?.row.DscResolucao??null,activation:row,additional:chosen?.row??null}];
 }).sort((x,y)=>x.month.localeCompare(y.month));
}
export function validatedFlagReference(reference:any,org:string,month:string){
 if(!reference||reference.organizationId!==org||reference.month!==month||reference.state!=='VALIDATED'||!Number.isInteger(reference.version)||reference.version<1||!reference.id||!/^[a-f0-9]{64}$/.test(reference.hash??'')||!flagColor(reference.color)||!/^\d{1,3}\.\d{6}$/.test(reference.rate??'')||!Array.isArray(reference.urls)||JSON.stringify(reference.urls)!==JSON.stringify(ANEEL_FLAG_URLS))return null;
 return reference;
}
