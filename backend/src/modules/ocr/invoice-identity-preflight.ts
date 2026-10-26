import {sourcePreparationEnabled} from './source-preparation-v3';
import {extractPdfText} from './eva-pdf-text.extractor';
import type {ExtractionResult} from './eva-extraction.model';
export type InvoiceRegistration={customerName:string|null;taxId:string|null;unitNumber:string|null;address:string|null;month:string|null;auditedUnitNumbers?:string[]};
const compact=(v:unknown)=>typeof v==='string'?v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,''):'';
const norm=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const monthNames=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
export function invoiceIdentityText(text:string,r:InvoiceRegistration){
 const t=norm(text),all=compact(text),checks:Record<string,string>={};
 const tax=compact(r.taxId),taxes=[...t.matchAll(/\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\s*\/?\s*[0-9A-Z]{4}-?[0-9]{2}\b/g)].map(m=>compact(m[0]));
 checks.taxId=!tax?'REVIEW':taxes.includes(tax)?'MATCH':taxes.length?'MISMATCH':'REVIEW';
 const uc=compact(r.unitNumber),accepted=new Set([uc,...(r.auditedUnitNumbers??[]).map(compact)].filter(Boolean)),units=[...t.matchAll(/(?:UNIDADE\s+CONSUMIDORA|NUMERO\s+DA\s+INSTALACAO|CODIGO\s+DA\s+INSTALACAO|INSTALACAO|SEU\s+CODIGO|\bUC\b)\s*(?:N[º°.]?|:)?\s*([0-9][0-9 .-]{4,30}[0-9])/g)].map(m=>compact(m[1]));
 checks.unit=!uc||!units.length?'REVIEW':units.every(n=>accepted.has(n))?'MATCH':'MISMATCH';
 // Preserve street numbers. Never accept the street alone or silently change the address.
 const address=compact(r.address);checks.address=address.length>=12&&all.includes(address)?'MATCH':'REVIEW';
 const found:string[]=[];for(const m of t.matchAll(/(?:REFERENCIA|REF\s*[:.]?\s*MES\s*\/\s*ANO|MES\s*\/\s*ANO|COMPETENCIA)\b/g)){
  const tail=t.slice(m.index!+m[0].length,m.index!+m[0].length+120);
  const named=/\b(JAN[A-Z]*|FEV[A-Z]*|MAR[A-Z]*|ABR[A-Z]*|MAI[A-Z]*|JUN[A-Z]*|JUL[A-Z]*|AGO[A-Z]*|SET[A-Z]*|OUT[A-Z]*|NOV[A-Z]*|DEZ[A-Z]*)\s*[/.-]?\s*(20\d{2})\b/.exec(tail);
  const numeric=/(?:^|[^0-9/])(0?[1-9]|1[0-2])\/(20\d{2})\b/.exec(tail);
  if(named)found.push(named[2]+'-'+String(monthNames.indexOf(named[1].slice(0,3))+1).padStart(2,'0'));else if(numeric)found.push(numeric[2]+'-'+numeric[1].padStart(2,'0'));
 }
 checks.period=!r.month||!found.length?'REVIEW':found.every(m=>m===r.month)?'MATCH':'MISMATCH';
 if(sourcePreparationEnabled()){
  const explicit=[...t.matchAll(/(?:NUMERO\s+DA\s+INSTALACAO|CODIGO\s+DA\s+INSTALACAO|UNIDADE\s+CONSUMIDORA|\bUC\b)\s*(?:N[º°.]?|:)?\s*([0-9][0-9.-]{4,30})\b/g)].map(m=>compact(m[1]));
  checks.unit=!uc||!explicit.length?'REVIEW':explicit.every(n=>accepted.has(n))?'MATCH':'MISMATCH';
  const streets=(v:string)=>{const n=norm(v),found:string[]=[];for(const m of n.matchAll(/\b(?:RUA|R\.?|AVENIDA|AV\.?)\s+([A-Z][A-Z .'-]{1,80}?)(?:,\s*|\s+)(\d+)\b/g)){const zip=/\b(\d{5})[- ](\d{3})\b/.exec(n.slice(m.index!+m[0].length,m.index!+m[0].length+180));if(zip)found.push(compact(m[1])+'|'+m[2]+'|'+zip[1]+zip[2]);}return found;};
  const registeredStreet=streets(r.address??'');if(registeredStreet.length===1&&streets(text).includes(registeredStreet[0]))checks.address='MATCH';
  const name=compact(r.customerName);
  const customerTax=taxes.filter(id=>{const match=[...t.matchAll(/\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\s*\/?\s*[0-9A-Z]{4}-?[0-9]{2}\b/g)].find(m=>compact(m[0])===id&&compact(t.slice(Math.max(0,m.index!-220),m.index)).includes(name));return Boolean(name.length>=8&&match);});
  checks.taxId=!tax?'REVIEW':customerTax.includes(tax)?'MATCH':customerTax.length?'MISMATCH':'REVIEW';
  // CPFL's customer strip may print its labels as a background image. The native
  // text retains the explicit customer CNPJ immediately followed by installation
  // and month. Read this narrow sequence, never an arbitrary nearby account code.
  if(all.includes('CPFLPAULISTA')||all.includes('COMPANHIAPAULISTADEFORCAELUZ')){
   // OCR serializes this CPFL header band before its data row. Bind the code to
   // the complete labeled row, customer and consistent readings; never take a
   // nearby meter, barcode or arbitrary number as the installation.
   if(checks.unit==='REVIEW'){
    const rows=[...t.matchAll(/CODIGO\s+DA\s+INSTALACAO\s+LEITURA\s+ATUAL\s+LEITURA\s+ANTERIOR\s+N[º°.]?\s*(?:DE\s+)?DIAS\s+([^\n]{8,180})\n\s*([0-9][0-9.-]{4,25})\s*\n\s*(\d{2}\/\d{2}\/\d{4})\s*\n\s*(\d{2}\/\d{2}\/\d{4})\s*\n\s*(\d{1,2})\b/g)].filter(m=>name.length>=8&&compact(m[1])===name);
    const date=(value:string)=>{const [day,month,year]=value.split('/').map(Number),ms=Date.UTC(year,month-1,day),d=new Date(ms);return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?ms:NaN;};
    if(rows.length&&rows.every(m=>Number(m[5])>=1&&Number(m[5])<=62&&(date(m[3])-date(m[4]))/86400000===Number(m[5])))checks.unit=rows.every(m=>accepted.has(compact(m[2])))?'MATCH':'MISMATCH';
   }

   const blocks=[...t.matchAll(/\bCNPJ\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\s*\/\s*\d{4}-?\d{2})\s+([0-9][0-9.-]{4,25})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*\/\s*(20\d{2})\b/g)]
    .filter(m=>compact(m[1])===tax&&name.length>=8&&compact(t.slice(Math.max(0,m.index!-350),m.index)).includes(name));
   if(blocks.length){checks.taxId='MATCH';checks.unit=uc&&blocks.every(m=>accepted.has(compact(m[2])))?'MATCH':'MISMATCH';checks.period=r.month&&blocks.every(m=>m[4]+'-'+String(monthNames.indexOf(m[3])+1).padStart(2,'0')===r.month)?'MATCH':'MISMATCH';}
  }

 }
 return {state:Object.values(checks).includes('MISMATCH')?'MISMATCH':Object.values(checks).every(s=>s==='MATCH')?'MATCH':'REVIEW',checks} as {state:'MATCH'|'MISMATCH'|'REVIEW';checks:Record<string,string>};
}
/** Local bounded text extraction only. Images/scans need one initial OCR to identify;
 * that initial OCR is never permission to import, draft, approve or publish. */
export async function invoiceIdentityPreflight(bytes:Buffer,mime:string,registration:InvoiceRegistration,fileHash:string,timeoutMs?:number,read?:()=>Promise<ExtractionResult>){
 const base={version:'invoice-identity-preflight-v1',fileHash,registration};
 if(mime!=='application/pdf')return {...base,state:'OCR_REQUIRED',checks:{source:'IMAGE_REQUIRES_INITIAL_OCR'}};
 try{const extracted=await (read?read():timeoutMs===undefined?extractPdfText(bytes):extractPdfText(bytes,timeoutMs));
  if(sourcePreparationEnabled()){
   const pages=new Set(extracted.sections.filter(s=>s.issues.some(i=>['LAYOUT_REVIEW','EMPTY_PAGE'].includes(i))).map(s=>s.page));
   const safe=extracted.sections.filter(s=>!pages.has(s.page));
   const identity=invoiceIdentityText(safe.map(s=>s.text).join('\n'),registration);
   if(identity.state!=='REVIEW'||!extracted.ocrRequired)return {...base,...identity,sourcePages:[...new Set(safe.map(s=>s.page))]};
  }
  if(extracted.ocrRequired)return {...base,state:'OCR_REQUIRED',checks:{source:'SCANNED_PDF_REQUIRES_INITIAL_OCR'}};
  return {...base,...invoiceIdentityText(extracted.sections.map(s=>s.text).join('\n'),registration)};
 }catch{return {...base,state:'REVIEW',checks:{source:'LOCAL_EXTRACTION_UNAVAILABLE'}};}
}

/** Exact code lineage from the existing immutable registration audit; no fuzzy UC matching. */
export function auditedUnitCodeHistory(rows:any[],org:string,customer:string,unit:string,current:string){
 const accepted=new Set<string>([compact(current)]),ids:string[]=[];
 for(const e of rows){
  const b=e.before_record,a=e.after_record;
  if(e.organization_id!==org||e.entity_kind!=='consumer_units'||e.entity_id!==unit||!e.id||!e.created_by||typeof e.reason!=='string'||e.reason.trim().length<3)continue;
  if(!b||!a||b.id!==unit||a.id!==unit||b.organization_id!==org||a.organization_id!==org||b.customer_id!==customer||a.customer_id!==customer)continue;
  const old=compact(b.consumer_unit_number),next=compact(a.consumer_unit_number);
  if(old.length>=5&&next.length>=5&&old!==next&&accepted.has(next)){accepted.add(old);ids.push(e.id);}
 }
 return {codes:[...accepted],editIds:ids};
}
