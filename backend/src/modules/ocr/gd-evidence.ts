import {decimalFromInvoice,electricalField,extractElectricalEvidence,type ElectricalField} from './electrical-evidence';
const norm=(s:unknown)=>typeof s==='string'?s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9%]+/g,' ').trim():'';
export type GdKind='CONSUMED'|'INJECTED'|'COMPENSATED'|'CREDIT_OPENING'|'CREDIT_CLOSING'|'CREDIT_RECEIVED'|'CREDIT_USED'|'CREDIT_EXPIRED'|'ALLOCATION_PERCENT';
const labels:Record<string,GdKind>={
 'ENERGIA CONSUMIDA GD':'CONSUMED','CONSUMO GD':'CONSUMED','ENERGIA INJETADA':'INJECTED','ENERGIA ATIVA INJETADA':'INJECTED','ENERGIA COMPENSADA':'COMPENSATED','ENERGIA ATIVA COMPENSADA':'COMPENSATED','CONSUMO COMPENSADO':'COMPENSATED',
 'SALDO ANTERIOR DE CREDITOS':'CREDIT_OPENING','SALDO ANTERIOR DE CREDITOS DE ENERGIA':'CREDIT_OPENING','SALDO ATUAL DE CREDITOS':'CREDIT_CLOSING','SALDO DE CREDITOS DE ENERGIA':'CREDIT_CLOSING','CREDITOS RECEBIDOS':'CREDIT_RECEIVED','CREDITOS DE ENERGIA RECEBIDOS':'CREDIT_RECEIVED','CREDITOS UTILIZADOS':'CREDIT_USED','CREDITOS DE ENERGIA UTILIZADOS':'CREDIT_USED','CREDITOS EXPIRADOS':'CREDIT_EXPIRED','PERCENTUAL DE RATEIO GD':'ALLOCATION_PERCENT','RATEIO GD':'ALLOCATION_PERCENT'
};
export function gdKind(label:string):GdKind|null {const n=norm(label).replace(/\b(?:KWH|MWH)\b|%/g,' ').replace(/\s+/g,' ').trim();return labels[n]??null;}
export interface GdCandidate {source:string;kind:GdKind;label:ElectricalField;value:ElectricalField;unit:string|null;unitEvidence?:ElectricalField;issues:string[];}
/** Evidence only. Never infer participation, sum duplicated credits or convert kWh into money. */
export function extractGdEvidence(raw:Record<string,any>){
 const records:GdCandidate[]=[];const issues:string[]=[];let signals=false;
 if(!Array.isArray(raw.documents)||raw.documents.length!==1)return {version:'gd-evidence-v1',detected:false,canImport:false,records,issues:['INVOICE_COUNT_NOT_ONE']};
 const add=(source:string,label:any,value:any,unitField?:ElectricalField)=>{
  const kind=gdKind(label?.content);if(!kind)return;signals=true;if(records.length>=500){issues.push('GD_LIMIT_REACHED');return;}
  const l=electricalField(raw,label),v=electricalField(raw,value,true);let unit:string|null=null;
  const suffix=v.text.trim().match(/\s*(kWh|MWh|%)$/i);if(suffix){v.decimal=decimalFromInvoice(v.text.trim().slice(0,-suffix[0].length));if(v.decimal!==null)v.issues=v.issues.filter(i=>i!=='INVALID_DECIMAL');}
  const units=(norm((label?.content??'')+' '+(unitField?.text??'')+' '+(suffix?.[1]??'')).match(/\b(?:KWH|MWH)\b|%/g)||[]);const distinct=[...new Set(units)];if(distinct.length===1)unit=distinct[0];
  const rowIssues=[...new Set([...l.issues,...v.issues,...(unitField?.issues??[])])];
  if(kind==='ALLOCATION_PERCENT'){
   if(unit!=='%')rowIssues.push('GD_UNIT_UNVERIFIED');
   if(v.decimal!==null&&(Number(v.decimal)<0||Number(v.decimal)>100))rowIssues.push('GD_PERCENT_OUT_OF_RANGE');
  }else if(!['KWH','MWH'].includes(unit??''))rowIssues.push('GD_UNIT_UNVERIFIED');
  if(v.decimal?.startsWith('-'))rowIssues.push('GD_SIGN_REVIEW');
  records.push({source,kind,label:l,value:v,unit,unitEvidence:unitField,issues:rowIssues});
 };
 const pairs=Array.isArray(raw.keyValuePairs)?raw.keyValuePairs:[];
 pairs.slice(0,500).forEach((p:any,i:number)=>{
  const label=norm(p?.key?.content),value=norm(p?.value?.content);
  if(['GERACAO DISTRIBUIDA','MICRO E MINI GERACAO','PARTICIPACAO NO SCEE'].includes(label)&&value&&!['NAO','N','0','NAO SE APLICA'].includes(value))signals=true;
  add('keyValuePairs['+i+']',{...p.key,confidence:p.confidence},{...p.value,confidence:p.confidence});
 });
 if(pairs.length>500)issues.push('GD_LIMIT_REACHED');
 extractElectricalEvidence(raw).rows.forEach(r=>{if(!gdKind(r.description.text))return;add(r.source,{content:r.description.text,confidence:r.description.confidence,spans:r.description.spans,boundingRegions:r.description.pages.map(pageNumber=>({pageNumber}))},{content:r.quantity.text,confidence:r.quantity.confidence,spans:r.quantity.spans,boundingRegions:r.quantity.pages.map(pageNumber=>({pageNumber}))},r.unit);});
 // Balance tables can coexist with Items: preserve candidates without adding them together.
 const tables=Array.isArray(raw.tables)?raw.tables:[];
 tables.slice(0,30).forEach((t:any,ti:number)=>{
  const cells=Array.isArray(t.cells)?t.cells:[];const rowNumbers=[...new Set<number>(cells.map((c:any)=>c.rowIndex).filter((n:any)=>Number.isInteger(n)&&n>=0))];
  if(rowNumbers.length>500)issues.push('GD_LIMIT_REACHED');
  for(const ri of rowNumbers.slice(0,500)){const row=cells.filter((c:any)=>c.rowIndex===ri);if(row.length!==2||row.some((c:any)=>(c.columnSpan??1)!==1||(c.rowSpan??1)!==1))continue;const label=row.find((c:any)=>c.columnIndex===0),value=row.find((c:any)=>c.columnIndex===1);if(label&&value)add('tables['+ti+'].row['+ri+']',{...label,confidence:null},{...value,confidence:null});}
 });
 if(tables.length>30)issues.push('GD_LIMIT_REACHED');
 if(records.length)issues.push('GD_VALUES_NOT_RECONCILED');
 if(signals)issues.push('GD_PROFILE_AND_VALIDITY_REQUIRE_REVIEW');
 const counts=new Map<string,number>();for(const r of records)counts.set(r.kind,(counts.get(r.kind)||0)+1);
 if([...counts.values()].some(n=>n>1))issues.push('GD_MULTIPLE_CANDIDATES_NO_SUM');
 return {version:'gd-evidence-v1',detected:signals,canImport:false,records,issues:[...new Set(issues)]};
}
