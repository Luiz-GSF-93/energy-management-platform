import {createHash} from 'node:crypto';
import {reconcileCpflOperations} from './cpfl-reconciliation';
import {reconcileCpflTaxes} from './cpfl-tax-reconciliation';

const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const cents=(s:string)=>/^-?\d+\.\d{2}$/.test(s)?BigInt(s.replace('.','')):null;

/** Explicit native text only: no image OCR, balancing entry or inferred credit sign. */
export function nativeInvoiceCredits(extraction:any,documentId:string,fileHash:string){
 const rows:any[]=[];
 for(const section of extraction?.sections??[]){
  if(typeof section.text!=='string'||!Number.isInteger(section.page)||section.page<1||(section.issues??[]).some((x:string)=>['LAYOUT_REVIEW','EMPTY_PAGE','HIDDEN_TEXT','LIMIT'].includes(x)))continue;
  for(const line of section.text.split('\n')){
   const match=/^(Desc\s+Energia\s+ACL\s+(?:Fora\s+(?:de\s+)?Ponta|Ponta))\s+((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})-\s*$/i.exec(line.trim());
   if(!match)continue;
   rows.push({documentId,fileHash,page:section.page,label:normalized(match[1]),decimal:'-'+match[2].replace(/\./g,'').replace(',','.'),text:line.trim(),textHash:createHash('sha256').update(line.trim()).digest('hex')});
  }
 }
 return rows;
}

/** Correct only a dropped negative sign independently printed in the same verified PDF.
 * Raw OCR text/confidence are retained; all original accounting checks must then agree. */
export function verifiedNativeInvoiceLayout<T extends {layoutId:any;operations:any[];reconciliation:any;blocks:any[]}>(layout:T,document:any,identity:any):T&{nativeCorrections?:any[]}{
 if(typeof document?.id!=='string'||!document.id||!/^[a-f0-9]{64}$/.test(document.file_hash??'')||layout.layoutId!=='cpfl-paulista-a'||identity?.state!=='MATCH'||identity.fileHash!==document?.file_hash||!Array.isArray(identity.nativeInvoiceCredits))return layout;
 const corrections:any[]=[];
 const operations=layout.operations.map(row=>{
  const amount=row.fields?.amount?.decimal;
  if(row.component!=='ACL_ENERGY_DISCOUNT'||row.role!=='CREDIT'||typeof amount!=='string'||cents(amount)===null||cents(amount)!<=0n)return row;
  const label=normalized(row.fields.description?.text??''),proofs=identity.nativeInvoiceCredits.filter((p:any)=>p.documentId===document.id&&p.fileHash===document.file_hash&&p.label===label&&typeof p.text==='string'&&typeof p.decimal==='string'&&cents(p.decimal)===-cents(amount)!&&p.textHash===createHash('sha256').update(p.text??'').digest('hex')&&nativeInvoiceCredits({sections:[{page:p.page,text:p.text,issues:[]}]},document.id,document.file_hash).some(p2=>p2.decimal===p.decimal&&p2.label===p.label));
  const charged=layout.operations.filter(other=>other.component==='ACL_DISTRIBUTOR_INFORMATION'&&other.role==='CHARGE'&&other.period===row.period&&other.fields?.amount?.decimal===amount);
  if(proofs.length!==1||charged.length!==1)return row;
  corrections.push({kind:'NATIVE_CREDIT_SIGN',source:row.source,ocrText:row.fields.amount.text,ocrDecimal:amount,decimal:proofs[0].decimal,native:proofs[0]});
  return {...row,fields:{...row.fields,amount:{...row.fields.amount,decimal:proofs[0].decimal}}};
 });
 if(!corrections.length)return layout;
 const reconciliation=reconcileCpflOperations(operations);
 if(reconciliation.state!=='MATCH')return layout;
 return {...layout,operations,reconciliation,taxReconciliation:reconcileCpflTaxes(operations,layout.blocks),nativeCorrections:corrections};
}
