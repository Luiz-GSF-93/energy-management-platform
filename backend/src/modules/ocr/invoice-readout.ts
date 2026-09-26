/** Sanitized, paginated projection of immutable OCR evidence. Never a financial approval. */
export type ReadoutSection='text'|'fields'|'pairs'|'tables';
export type ReadoutQuery={page:number;section:ReadoutSection;offset:number};
const arr=(v:any):any[]=>Array.isArray(v)?v:[];
const str=(v:any):string=>typeof v==='string'?v:'';
const confidence=(v:any):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1?v:null;
const band=(c:number|null)=>c===null?'UNKNOWN':c<0.45?'LOW':c<=0.85?'REVIEW':'HIGH';
function stats(values:(number|null)[]){const known=values.filter((n):n is number=>n!==null);return {total:values.length,known:known.length,missing:values.length-known.length,low:known.filter(c=>c<0.45).length,review:known.filter(c=>c>=0.45&&c<=0.85).length,high:known.filter(c=>c>0.85).length,minimum:known.length?known.reduce((a,b)=>Math.min(a,b),1):null,mean:known.length?known.reduce((a,b)=>a+b,0)/known.length:null};}
function pagesOf(raw:any,v:any):number[]{const valid=new Set(arr(raw.pages).map(p=>p.pageNumber));return [...new Set<number>(arr(v?.boundingRegions).map(r=>r?.pageNumber).filter(n=>Number.isInteger(n)&&n>0&&valid.has(n)))];}
function evidence(raw:any,v:any){const content=str(v?.content),text=str(raw.content);const spans=arr(v?.spans).filter(s=>Number.isInteger(s?.offset)&&s.offset>=0&&Number.isInteger(s.length)&&s.length>0&&s.offset+s.length<=text.length).map(s=>({offset:s.offset,length:s.length}));const pages=pagesOf(raw,v);const c=confidence(v?.confidence);return {text:content,confidence:c,band:band(c),pages,sourceVerified:!!pages.length&&!!spans.length&&spans.map(s=>text.slice(s.offset,s.offset+s.length)).join(' ').replace(/\s/g,'')===content.replace(/\s/g,'')};}

const technicalTerms=/(?:energia|consumo|demanda|tarif|tusd|\bte\b|\bacl\b|\bacr\b|kwh|mwh|kvar|\bkw\b|reativ|fator de potencia|ultrapass|encargo|icms|pis|cofins|cosip|\bcip\b|bandeira|compensa|credit|injet|geracao|rateio|saldo|fatur|tribut|imposto|subven|cde|leitura|medidor|tensao|modalidade|classifica|fornecimento|competencia|referencia|ref[.;:]|mes\/|periodo|vencimento|total|valor|cnpj|unidade consumidora|numero da uc|instalacao)/;
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const relevantInvoiceText=(s:string)=>technicalTerms.test(normalize(s));
const informational=(s:string)=>/(?:ouvidoria|fale conosco|redes sociais|siga.nos|campanha|noticias|canal de atendimento|central de atendimento)/.test(normalize(s));

function fieldsOf(raw:any){const out:any[]=[];let truncated=false,nodes=0;
 const walk=(v:any,path:string,depth:number,context='')=>{if(++nodes>20000||depth>20){truncated=true;return;}if(!v||typeof v!=='object')return;
  if(v.valueObject&&typeof v.valueObject==='object'&&!Array.isArray(v.valueObject)){for(const [k,child] of Object.entries(v.valueObject))walk(child,path+'.'+k,depth+1,str(v.content)||str(v.valueObject?.Description?.content)||context);return;}
  if(Array.isArray(v.valueArray)){v.valueArray.forEach((child:any,i:number)=>walk(child,path+'['+i+']',depth+1,context));return;}
  if(typeof v.content==='string'&&!informational(context||v.content)&&(relevantInvoiceText(context+' '+v.content)||/(CustomerName|CustomerTaxId|CustomerAddress|InvoiceId|InvoiceDate|InvoiceTotal|TotalTax|SubTotal|AmountDue|BillingAddress|ServiceAddress|ServiceStartDate|ServiceEndDate|DueDate|VendorName|VendorTaxId)$/.test(path)))out.push({id:path,label:path,...evidence(raw,v)});
 };
 arr(raw.documents).forEach((d,i)=>{for(const [k,v] of Object.entries(d?.fields??{}))walk(v,'documents['+i+'].'+k,0);});return {rows:out,truncated};
}
export function ocrReadoutSummary(raw:any,checks:any[]=[]){
 const fields=fieldsOf(raw);
 const criticalNames=['customer','taxId','unit','address','period','market'];
 const critical=criticalNames.map(name=>arr(checks).find(c=>c.field===name));const criticalValues=critical.map(c=>confidence(c?.confidence));
 return {version:'ocr-readout-v1',pages:[...new Set<number>(arr(raw.pages).map(p=>p?.pageNumber).filter(n=>Number.isInteger(n)&&n>0))].sort((a,b)=>a-b),fieldConfidence:stats(fields.rows.map(f=>f.confidence)),pairConfidence:stats(arr(raw.keyValuePairs).filter(p=>relevantInvoiceText(str(p?.key?.content))&&!informational(str(p?.key?.content))).map(p=>confidence(p?.confidence))),criticalConfidence:{...stats(criticalValues),complete:criticalValues.every(c=>c!==null),minimumAll:criticalValues.every(c=>c!==null)?Math.min(...criticalValues as number[]):null,matched:critical.filter(c=>c?.state==='MATCH').length},tables:arr(raw.tables).length,fieldsTruncated:fields.truncated,automaticApproval:false};
}
export function invoiceReadout(raw:any,q:ReadoutQuery){
 const belongs=(pages:number[])=>q.page===0?pages.length===0:pages.includes(q.page);
 const summary=ocrReadoutSummary(raw);if(q.page!==0&&!summary.pages.includes(q.page))throw Error('PAGE_NOT_FOUND');
 let rows:any[]=[],text='',truncated=false;const size=q.section==='text'?12000:25;
 if(q.section==='text'){
  if(q.page===0)text=str(raw.content);
  else {const page=arr(raw.pages).find(p=>p.pageNumber===q.page);const content=str(raw.content);const spans=arr(page?.spans).filter(s=>Number.isInteger(s?.offset)&&s.offset>=0&&Number.isInteger(s.length)&&s.length>0&&s.offset+s.length<=content.length);text=spans.length?spans.map(s=>content.slice(s.offset,s.offset+s.length)).join('\n'):arr(page?.lines).map(l=>str(l?.content)).join('\n');}
 let continuation=false;text=text.split('\n').filter(line=>{if(informational(line)){continuation=false;return false;}if(relevantInvoiceText(line)){continuation=true;return true;}if(continuation&&/^[\d\s.,%R$()+\-/:]+$/.test(line)&&/\d/.test(line))return true;continuation=false;return false;}).join('\n');
 }else if(q.section==='fields'){const f=fieldsOf(raw);rows=f.rows.filter(r=>belongs(r.pages));truncated=f.truncated;
 }else if(q.section==='pairs'){
  rows=arr(raw.keyValuePairs).map((p,i)=>{const key=evidence(raw,{...p?.key,confidence:p?.confidence}),value=evidence(raw,{...p?.value,confidence:p?.confidence});const pages=[...new Set([...key.pages,...value.pages])];return {id:'pair-'+i,key,value,pages};}).filter(r=>belongs(r.pages)&&relevantInvoiceText(r.key.text)&&!informational(r.key.text));
 }else {
  arr(raw.tables).forEach((t,ti)=>{if(!arr(t?.cells).some(c=>relevantInvoiceText(str(c?.content))))return;const grouped=new Map<number,any[]>();arr(t?.cells).forEach((c,ci)=>{if(!Number.isInteger(c?.rowIndex)||c.rowIndex<0||informational(str(c.content)))return;const e=evidence(raw,c);const pages=e.pages.length?e.pages:pagesOf(raw,t);if(!belongs(pages))return;const list=grouped.get(c.rowIndex)||[];list.push({id:ti+'-'+ci,column:c.columnIndex,columnSpan:c.columnSpan??1,rowSpan:c.rowSpan??1,kind:str(c.kind),...e,pages});grouped.set(c.rowIndex,list);});for(const [row,cells] of grouped)rows.push({id:'table-'+ti+'-row-'+row,table:ti+1,row:row+1,cells:cells.sort((a,b)=>(a.column??0)-(b.column??0))});});
 }
 const total=q.section==='text'?text.length:rows.length;const next=q.offset+size<total?q.offset+size:null;
 return {version:'ocr-readout-v1',page:q.page,section:q.section,offset:q.offset,total,nextOffset:next,previousOffset:q.offset>0?Math.max(0,q.offset-size):null,truncated,text:q.section==='text'?text.slice(q.offset,q.offset+size):'',rows:q.section==='text'?[]:rows.slice(q.offset,q.offset+size)};
}
