import {extractPdfText} from './eva-pdf-text.extractor';
export type InvoiceRegistration={customerName:string|null;taxId:string|null;unitNumber:string|null;address:string|null;month:string|null};
const compact=(v:unknown)=>typeof v==='string'?v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,''):'';
const norm=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const monthNames=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
export function invoiceIdentityText(text:string,r:InvoiceRegistration){
 const t=norm(text),all=compact(text),checks:Record<string,string>={};
 const tax=compact(r.taxId),taxes=[...t.matchAll(/\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\s*\/?\s*[0-9A-Z]{4}-?[0-9]{2}\b/g)].map(m=>compact(m[0]));
 checks.taxId=!tax?'REVIEW':taxes.includes(tax)?'MATCH':taxes.length?'MISMATCH':'REVIEW';
 const uc=compact(r.unitNumber),units=[...t.matchAll(/(?:UNIDADE\s+CONSUMIDORA|NUMERO\s+DA\s+INSTALACAO|CODIGO\s+DA\s+INSTALACAO|INSTALACAO|SEU\s+CODIGO|\bUC\b)\s*(?:N[º°.]?|:)?\s*([0-9][0-9 .-]{4,30}[0-9])/g)].map(m=>compact(m[1]));
 checks.unit=!uc||!units.length?'REVIEW':units.every(n=>n===uc)?'MATCH':'MISMATCH';
 // Preserve street numbers. Never accept the street alone or silently change the address.
 const address=compact(r.address);checks.address=address.length>=12&&all.includes(address)?'MATCH':'REVIEW';
 const found:string[]=[];for(const m of t.matchAll(/(?:REFERENCIA|REF\s*[:.]?\s*MES\s*\/\s*ANO|MES\s*\/\s*ANO|COMPETENCIA)\b/g)){
  const tail=t.slice(m.index!+m[0].length,m.index!+m[0].length+120);
  const named=/\b(JAN[A-Z]*|FEV[A-Z]*|MAR[A-Z]*|ABR[A-Z]*|MAI[A-Z]*|JUN[A-Z]*|JUL[A-Z]*|AGO[A-Z]*|SET[A-Z]*|OUT[A-Z]*|NOV[A-Z]*|DEZ[A-Z]*)\s*[/.-]?\s*(20\d{2})\b/.exec(tail);
  const numeric=/(?:^|[^0-9/])(0?[1-9]|1[0-2])\/(20\d{2})\b/.exec(tail);
  if(named)found.push(named[2]+'-'+String(monthNames.indexOf(named[1].slice(0,3))+1).padStart(2,'0'));else if(numeric)found.push(numeric[2]+'-'+numeric[1].padStart(2,'0'));
 }
 checks.period=!r.month||!found.length?'REVIEW':found.every(m=>m===r.month)?'MATCH':'MISMATCH';
 return {state:Object.values(checks).includes('MISMATCH')?'MISMATCH':Object.values(checks).every(s=>s==='MATCH')?'MATCH':'REVIEW',checks} as {state:'MATCH'|'MISMATCH'|'REVIEW';checks:Record<string,string>};
}
/** Local bounded text extraction only. Images/scans need one initial OCR to identify;
 * that initial OCR is never permission to import, draft, approve or publish. */
export async function invoiceIdentityPreflight(bytes:Buffer,mime:string,registration:InvoiceRegistration,fileHash:string){
 const base={version:'invoice-identity-preflight-v1',fileHash,registration};
 if(mime!=='application/pdf')return {...base,state:'OCR_REQUIRED',checks:{source:'IMAGE_REQUIRES_INITIAL_OCR'}};
 try{const extracted=await extractPdfText(bytes);if(extracted.ocrRequired)return {...base,state:'OCR_REQUIRED',checks:{source:'SCANNED_PDF_REQUIRES_INITIAL_OCR'}};
  return {...base,...invoiceIdentityText(extracted.sections.map(s=>s.text).join('\n'),registration)};
 }catch{return {...base,state:'REVIEW',checks:{source:'LOCAL_EXTRACTION_UNAVAILABLE'}};}
}
