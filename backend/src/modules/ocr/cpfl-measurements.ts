import {electricalField,decimalFromInvoice,classifyElectricalLine,type ElectricalField} from './electrical-evidence';
const arr=(v:any):any[]=>Array.isArray(v)?v:[];
const str=(v:any):string=>typeof v==='string'?v:'';
const norm=(v:any)=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const months=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
export type MeterReading={source:string;kind:string;period:string;unit:string|null;fields:Record<string,ElectricalField>;issues:string[]};
export type HistoryReading={source:string;reference:string|null;metric:'CONSUMPTION'|'DEMAND';period:string;unit:'kWh'|'kW';decimal:string|null;days:number|null;evidence:ElectricalField[];issues:string[]};
const columns:Record<string,string>={'MEDIDOR':'meter','GRANDEZAS':'quantityKind','POSTOS HORARIOS':'period','LEITURA ANTERIOR':'previous','LEITURA ATUAL':'current','CONST MEDIDOR':'constant','CONSUMO KWH':'reading'};
export function cpflReference(value:string):string|null {const aliases:Record<string,string>={JANEIRO:'JAN',FEVEREIRO:'FEV',MARCO:'MAR',ABRIL:'ABR',MAIO:'MAI',JUNHO:'JUN',JULHO:'JUL',AGOSTO:'AGO',SETEMBRO:'SET',OUTUBRO:'OUT',NOVEMBRO:'NOV',DEZEMBRO:'DEZ'};const normalized=str(value).trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();const full=/^([A-Z]+)[ /-]+(20[0-9]{2}|21[0-9]{2})$/.exec(normalized);if(!full)return null;const month=aliases[full[1]]??full[1];return months.includes(month)?full[2]+'-'+String(months.indexOf(month)+1).padStart(2,'0'):null;}
function historyReference(token:string,anchor:string|null){const m=/^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*[/ -]?\s*([0-9]{4}|[0-9]{2})$/.exec(token);if(!m)return null;let year=Number(m[2]);const month=months.indexOf(m[1])+1;
 if(m[2].length===2){if(!anchor)return null;const a=Number(anchor.slice(0,4));year=Math.floor(a/100)*100+year;if(year>a)year-=100;}
 if(year<2000||year>2199)return null;
 const ref=year+'-'+String(month).padStart(2,'0');if(anchor){const distance=(Number(anchor.slice(0,4))-year)*12+Number(anchor.slice(5,7))-month;if(distance<0||distance>24)return null;}return ref;
}
/** CPFL-specific projection; caller must first identify distributor and Group A layout. */
export function extractCpflMeasurements(raw:any,anchor:string|null){
 const meterReadings:MeterReading[]=[],history:HistoryReading[]=[],issues:string[]=[];
 arr(raw?.tables).slice(0,50).forEach((t,ti)=>{
  const cells=arr(t.cells),head=cells.filter(c=>c.rowIndex===0),rows=[...new Set<number>(cells.map(c=>c.rowIndex).filter(n=>Number.isInteger(n)&&n>0))].sort((a,b)=>a-b);
  if(head.some(c=>norm(c.content)==='MEDIDOR')&&head.some(c=>norm(c.content)==='GRANDEZAS')){
   const mapping=new Map<number,string>(),used=new Set<string>();let bad=false;
   for(const c of head){const k=columns[norm(c.content)];if(!k)continue;if(used.has(k)||mapping.has(c.columnIndex)||(c.columnSpan??1)!==1||(c.rowSpan??1)!==1)bad=true;used.add(k);mapping.set(c.columnIndex,k);}
   if(bad||Object.values(columns).some(k=>!used.has(k))){issues.push('METER_HEADERS_AMBIGUOUS');return;}
   for(const ri of rows){if(meterReadings.length>=100){issues.push('MEASUREMENT_LIMIT_REACHED');break;}const fields:Record<string,ElectricalField>={},rowIssues:string[]=[];
    for(const c of cells.filter(c=>c.rowIndex===ri)){const k=mapping.get(c.columnIndex);if(!k)continue;if(fields[k]||(c.columnSpan??1)!==1||(c.rowSpan??1)!==1){rowIssues.push('METER_CELL_AMBIGUOUS');continue;}fields[k]=electricalField(raw,c,['previous','current','constant','reading'].includes(k));}
    if(!Object.values(fields).some(f=>f.text.trim()))continue;
    const label=norm(fields.quantityKind?.text),period=classifyElectricalLine(fields.period?.text??'').period;
    const kind=/^ENERGIA ATIVA KWH$/.test(label)?'ACTIVE_ENERGY':/^DEMANDA ATIVA KW$/.test(label)?'ACTIVE_DEMAND':/^ENERGIA REATIVA KVARH$/.test(label)?'REACTIVE_ENERGY':'OTHER';
    const unit=kind==='ACTIVE_ENERGY'?'kWh':kind==='ACTIVE_DEMAND'?'kW':kind==='REACTIVE_ENERGY'?'kVArh':null;
    if(kind==='OTHER')rowIssues.push('METER_QUANTITY_UNMAPPED');if(period==='UNSPECIFIED')rowIssues.push('METER_PERIOD_UNMAPPED');
    if(Object.values(columns).some(k=>!fields[k]?.text.trim()))rowIssues.push('METER_FIELDS_MISSING');
    if(Object.values(fields).some(f=>f.issues.length))rowIssues.push('METER_FIELD_REVIEW_REQUIRED');
    meterReadings.push({source:'tables['+ti+'].row['+ri+']',kind,period,unit,fields,issues:rowIssues});
   }return;
  }
  const ends=head.filter(c=>/^N DIAS FAT$/.test(norm(c.content))).sort((a,b)=>a.columnIndex-b.columnIndex);
  if(!ends.length)return;
  let start=0;
  for(const end of ends){const limit=end.columnIndex;const headings=head.filter(c=>c.columnIndex>=start&&c.columnIndex<limit);const label=headings.map(c=>norm(c.content)).join(' ');const period=classifyElectricalLine(label).period;
   const metric=/\bCONSUMO\b/.test(label)&&/\bKWH\b/.test(label)?'CONSUMPTION':/\bDEMANDA\b/.test(label)&&/\bKW\b/.test(label)?'DEMAND':null;
   if(!metric||period==='UNSPECIFIED'||headings.some(c=>c.columnIndex+(c.columnSpan??1)>limit)||(end.columnSpan??1)!==1){issues.push('HISTORY_HEADERS_AMBIGUOUS');start=limit+1;continue;}
   for(const ri of rows){if(history.length>=200){issues.push('HISTORY_LIMIT_REACHED');break;}
    const segment=cells.filter(c=>c.rowIndex===ri&&c.columnIndex>=start&&c.columnIndex<limit&&str(c.content).trim()).sort((a,b)=>a.columnIndex-b.columnIndex);
    if(!segment.length)continue;
    const dayCells=cells.filter(c=>c.rowIndex===ri&&c.columnIndex===limit);const evidence=segment.map(c=>electricalField(raw,c));const rowIssues:string[]=[];
    const data=segment.filter(c=>!(c.columnIndex===start&&headings.some(h=>h.columnIndex===start&&!str(h.content).trim())&&['/',metric==='CONSUMPTION'?'CONSUMO':'DEMANDA',metric==='CONSUMPTION'?'KWH':'KW'].includes(norm(c.content)||str(c.content).trim())));
    const joined=data.map(c=>str(c.content).trim()).join(' ');const regex=/\b(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*[/ -]?\s*(?:[0-9]{4}|[0-9]{2})\b/g;
    const tokens=joined.toUpperCase().match(regex)??[];const ambiguous=data.some(c=>(c.rowSpan??1)!==1||c.columnIndex+(c.columnSpan??1)>limit)||tokens.length!==1;
    const reference=!ambiguous?historyReference(tokens[0],anchor):null;
    const value=!ambiguous?decimalFromInvoice(joined.toUpperCase().replace(regex,'').trim()):null;
    if(value?.startsWith('-'))rowIssues.push('HISTORY_NEGATIVE_VALUE');
    if(ambiguous||value===null)rowIssues.push('HISTORY_VALUE_AMBIGUOUS');if(!reference)rowIssues.push('HISTORY_REFERENCE_UNVERIFIED');
    const day=dayCells.length===1&&(dayCells[0].columnSpan??1)===1&&(dayCells[0].rowSpan??1)===1?str(dayCells[0].content).trim():'';const days=/^[0-9]{1,2}$/.test(day)&&Number(day)>=1&&Number(day)<=62?Number(day):null;
    if(days===null)rowIssues.push('HISTORY_DAYS_UNVERIFIED');if(dayCells.length===1)evidence.push(electricalField(raw,dayCells[0],true));
    if(evidence.some(f=>f.issues.length))rowIssues.push('HISTORY_FIELD_REVIEW_REQUIRED');
    history.push({source:'tables['+ti+'].row['+ri+'].columns['+start+'-'+limit+']',reference,metric,period,unit:metric==='CONSUMPTION'?'kWh':'kW',decimal:value,days,evidence,issues:rowIssues});
   }start=limit+1;
  }
 });
 const keys=new Map<string,HistoryReading[]>();for(const r of history){if(!r.reference)continue;const key=r.reference+'|'+r.metric+'|'+r.period;keys.set(key,[...(keys.get(key)??[]),r]);}for(const entries of keys.values())if(entries.length>1)entries.forEach(r=>r.issues.push('HISTORY_DUPLICATE_CANDIDATES'));
 return {version:'cpfl-measurements-v1',canImport:false,meterReadings,history,issues:[...new Set(issues)]};
}
