import {fork} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {BadRequestException} from '@nestjs/common';
import {calendarSource,cceeObject,cceeText,dateOnly} from './ccee-data.model';
export type CalendarItem={code:string;title:string;month:string|null;dueAt:string|null;dueDate?:string;precision?:'DATE'|'HOUR';sourceRow:number;sourceSheet:string;applicability:string};
export type CalendarMapping={sheet:string;firstRow:number;titleColumn:number;dateColumn:number;monthColumn:number;applicabilityColumn:number;year:number};
export function calendarMapping(input:unknown):CalendarMapping{
 const b=cceeObject(input,['sheet','firstRow','titleColumn','dateColumn','monthColumn','applicabilityColumn','year']);cceeText(b.sheet,100,1);
 if(!Number.isInteger(b.firstRow)||b.firstRow<1||b.firstRow>9999||!Number.isInteger(b.year)||b.year<2021||b.year>2099)throw new BadRequestException('Mapeamento de calendário inválido.');
 for(const key of ['titleColumn','dateColumn','monthColumn','applicabilityColumn'])if(!Number.isInteger(b[key])||b[key]<1||b[key]>100)throw new BadRequestException('Colunas são numeradas a partir de 1.');
 if(new Set([b.titleColumn,b.dateColumn,b.monthColumn,b.applicabilityColumn]).size!==4)throw new BadRequestException('Selecione colunas distintas.');return b as CalendarMapping;
}
function sourceDate(value:unknown){
 if(typeof value==='number'){
  // Excel 1900 date system only. 1904 workbooks are rejected by the worker.
  if(!Number.isInteger(value)||value<44197||value>73050)throw new Error('CALENDAR_DATE_AMBIGUOUS');
  return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
 }
 if(typeof value!=='string')throw new Error('CALENDAR_DATE_AMBIGUOUS');
 const brazil=value.trim().match(/^(\d{2})\/(\d{2})\/(20\d{2})$/);
 return dateOnly(brazil?`${brazil[3]}-${brazil[2]}-${brazil[1]}`:value.trim().slice(0,10));
}
export function mappedCalendar(grid:{name:string;rows:any[][]}[],mapping:CalendarMapping){
 const selected=grid.find(s=>s.name===mapping.sheet);if(!selected)throw new BadRequestException('Planilha não encontrada. Confira o mapeamento.');
 const items:CalendarItem[]=[],issues:{row:number;reason:string}[]=[],codes=new Set<string>();
 selected.rows.slice(mapping.firstRow-1).forEach((row,offset)=>{
  if(!row||row.every(v=>v===null||v===''))return;
  const sourceRow=offset+mapping.firstRow;
  try{
   const title=cceeText(row[mapping.titleColumn-1],160),day=sourceDate(row[mapping.dateColumn-1]);
   const month=String(row[mapping.monthColumn-1]??'').trim(),applicability=cceeText(row[mapping.applicabilityColumn-1],500);
   if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||Number(day.slice(0,4))!==mapping.year)throw new Error('DATE_OR_COMPETENCE');
   // Date-only sources do not prove an hour. Require it in the source field explicitly.
   const dateValue=String(row[mapping.dateColumn-1]??''),full=dateValue.match(/^(20\d{2}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)-03:00$/);
   if(!full)throw new Error('DEADLINE_HOUR_REQUIRED');
   const dueAt=full[0];if(!Number.isFinite(Date.parse(dueAt)))throw new Error('DEADLINE_INVALID');
   const code=createHash('sha256').update([title,month,applicability].join('|')).digest('hex');
   if(codes.has(code))throw new Error('DUPLICATE');codes.add(code);items.push({code,title,month,dueAt,sourceRow,sourceSheet:mapping.sheet,applicability});
  }catch{issues.push({row:sourceRow,reason:'Conferir título, competência, aplicabilidade e data/hora explícita na fonte; nenhum prazo foi presumido.'});}
 });
 if(items.length>5000||issues.length>1000)throw new BadRequestException('Calendário excede os limites de curadoria.');
 return{items,issues,complete:items.length>0&&issues.length===0,coverage:{sheet:mapping.sheet,firstRow:mapping.firstRow,examinedRows:selected.rows.length-mapping.firstRow+1,year:mapping.year}};
}
export function isolatedCalendar(bytes:Buffer):Promise<{name:string;rows:any[][]}[]>{
 return new Promise((resolve,reject)=>{
  let done=false;const child=fork(join(__dirname,'ccee-calendar.worker.js'),[],{execArgv:['--max-old-space-size=128'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},stdio:['ignore','ignore','ignore','ipc']});
  const finish=(error?:Error,grid?:any)=>{if(done)return;done=true;clearTimeout(timer);child.kill();error?reject(error):resolve(grid);};
  const timer=setTimeout(()=>finish(new BadRequestException('Calendário excedeu o tempo de leitura; revisar arquivo.')),10000);
  child.on('error',()=>finish(new BadRequestException('Leitor isolado indisponível.')));
  child.on('exit',()=>{if(!done)finish(new BadRequestException('Leitura do calendário não confirmada.'));});
  child.on('message',(v:any)=>{if(v?.error||!Array.isArray(v?.grid)||Buffer.byteLength(JSON.stringify(v))>2097152)finish(new BadRequestException('Layout não homologado; revise a fonte e o mapeamento.'));else finish(undefined,v.grid);});
  child.send({base64:bytes.toString('base64')});
 });
}
export async function downloadCalendar(source:string,transport:typeof fetch=fetch){
 const url=calendarSource(source),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await transport(url,{redirect:'error',signal:controller.signal});if(!response.ok||!response.body)throw new Error();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let count=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;count+=value.length;if(count>5242880){await reader.cancel();throw new Error();}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks);if(bytes.length<8)throw new Error();return bytes;
 }catch{throw new BadRequestException('Documento oficial não obtido integralmente; nenhum prazo foi cadastrado.');}finally{clearTimeout(timer);}
}

/** Official annual workbook v9: C=reference month, P=deadline; D may prove a deadline hour. */
export function officialAnnualCalendar(grid:{name:string;rows:any[][];merges?:{s:{r:number;c:number};e:{r:number;c:number}}[]}[],year:number){
 const names=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
 const items:CalendarItem[]=[],issues:{row:number;sheet:string;reason:string}[]=[],groups=new Map<string,{item:CalendarItem;reports:Set<string>}>();
 if(!Number.isInteger(year)||year<2021||year>2099)throw new BadRequestException('Ano inválido.');
 for(const name of names){
  const sheet=grid.find(s=>s.name===name);if(!sheet)throw new BadRequestException('Calendário anual incompleto: '+name);
  if(!String(sheet.rows[0]?.[2]??'').toLowerCase().includes('calendário geral de operações e relatórios '+year))throw new BadRequestException('Cabeçalho oficial não reconhecido.');
  const cell=(r:number,c:number)=>{const range=sheet.merges?.find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);return range?sheet.rows[range.s.r]?.[range.s.c]:sheet.rows[r]?.[c];};
  for(let r=3;r<sheet.rows.length;r++){
   if(cell(r,15)==null)continue;
   try{
    const activity=String(cell(r,1)??'').trim(),category=String(cell(r,0)??'').trim(),day=sourceDate(cell(r,15)),month=String(cell(r,2)??'').trim()==='-'?null:sourceDate(cell(r,2)).slice(0,7),rule=String(cell(r,3)??'').trim();
    if(activity.length<3||!category||Number(day.slice(0,4))!==year)throw Error('ROW');
    const hours=[...rule.matchAll(/(?:até\s+(?:as|às)\s+)([0-2]?\d)h([0-5]\d)?/gi)];
    const hour=hours.length===1&&Number(hours[0][1])<24?hours[0][1].padStart(2,'0')+':'+(hours[0][2]??'00')+':00':null;
    if(/até\s+(?:as|às)/i.test(rule)&&!hour)throw Error('HOUR_AMBIGUOUS');
    const reports=[...new Set(Array.from({length:9},(_,i)=>String(cell(r,i+5)??'').replace(/\s/g,'')).filter(v=>v&&v!=='-'))];
    const applicability=[category,rule,reports.join(', ')].filter(Boolean).join(' · ');
    if(applicability.length>500)throw Error('DETAIL_LIMIT');
    const code=createHash('sha256').update([name,activity,category,month,day,rule].join('|')).digest('hex'),prior=groups.get(code);
    if(prior){for(const report of reports)prior.reports.add(report);const detail=[category,rule,[...prior.reports].join(', ')].filter(Boolean).join(' · ');if(detail.length>500)throw Error('DETAIL_LIMIT');prior.item.applicability=detail;}
    else{const item:CalendarItem={code,title:activity.length>160?activity.slice(0,157)+'…':activity,month,dueDate:day,dueAt:hour?day+'T'+hour+'-03:00':null,precision:hour?'HOUR':'DATE',sourceRow:r+1,sourceSheet:name,applicability};items.push(item);groups.set(code,{item,reports:new Set(reports)});}
   }catch{issues.push({row:r+1,sheet:name,reason:'Conferir atividade, competência ou prazo na linha oficial; nenhum horário foi presumido.'});}
  }
 }
 if(items.length>5000||issues.length>1000)throw new BadRequestException('Limite de calendário.');
 return{items,issues,complete:items.length>0&&issues.length===0,coverage:{sheet:'12 meses oficiais',year,examinedRows:grid.filter(s=>names.includes(s.name)).reduce((n,s)=>n+s.rows.length,0),precision:'Data; hora somente quando explícita na coluna Prazo',adapter:'CCEE_ANNUAL_V9'}};
}
