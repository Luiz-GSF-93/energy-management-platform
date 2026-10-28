import {extractPdfText} from './eva-pdf-text.extractor';
import type {ExtractionResult} from './eva-extraction.model';
import {ServiceUnavailableException} from '@nestjs/common';
import {invoiceIdentityPreflight,auditedUnitCodeHistory,InvoiceRegistration} from './invoice-identity-preflight';
import {sourcePreparationEnabled} from './source-preparation-v3';

/** Exact audited aliases only; shared by the first read and subsequent source inspections. */
export async function invoiceIdentityWithHistory(db:any,bytes:Buffer,mime:string,registration:InvoiceRegistration,fileHash:string,scope:{org:string;customer:string;unit:string;document:string},timeoutMs?:number,read?:()=>Promise<ExtractionResult>){
 const clean=Object.fromEntries(['customerName','taxId','unitNumber','address','month'].map(k=>[k,registration[k as keyof InvoiceRegistration]])) as InvoiceRegistration;
 // The same verified bytes are parsed once, including audited-alias reconciliation.
 let extraction:Promise<ExtractionResult>|undefined;
 const once=()=>extraction??=(read?read():timeoutMs===undefined?extractPdfText(bytes):extractPdfText(bytes,timeoutMs));
 let proof=await invoiceIdentityPreflight(bytes,mime,clean,fileHash,timeoutMs,once);
 if(sourcePreparationEnabled()&&'unit' in proof.checks&&['MISMATCH','REVIEW'].includes(proof.checks.unit)){
  if(process.env.EVA_AUTOMATIC_INTAKE_ENABLED==='true'){
   const result=await db.rpc('ocr_identity_native_lineage',{p_org:scope.org,p_customer:scope.customer,p_unit:scope.unit,p_document:scope.document,p_hash:fileHash});
   const lineage=result.data;
   if(result.error||!lineage||!['codes','editIds','aliasIds'].every(k=>Array.isArray(lineage[k])&&lineage[k].length<=200&&lineage[k].every((v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=64)))throw new ServiceUnavailableException('Não foi possível conferir a correspondência histórica da unidade.');
   if(lineage.editIds.length||lineage.aliasIds.length){
    const audited=await invoiceIdentityPreflight(bytes,mime,{...clean,auditedUnitNumbers:lineage.codes},fileHash,timeoutMs,once);
    if(audited.state==='MATCH')return {...audited,...(lineage.editIds.length?{registrationEditIds:lineage.editIds}:{}),...(lineage.aliasIds.length?{registrationAliasIds:lineage.aliasIds}:{})};
    // Persist an unresolved original check under its ordinary registration.
    // Audited aliases never attest the remaining CNPJ, address or period.
    return proof;
   }
   return proof;
  }

  const history=await db.from('registration_edits').select('*').eq('organization_id',scope.org).eq('entity_kind','consumer_units').eq('entity_id',scope.unit).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100);
  if(history.error||!Array.isArray(history.data))throw new ServiceUnavailableException('Não foi possível conferir o histórico auditado da unidade.');
  const lineage=auditedUnitCodeHistory(history.data,scope.org,scope.customer,scope.unit,clean.unitNumber??'');
  if(lineage.editIds.length){
   proof=await invoiceIdentityPreflight(bytes,mime,{...clean,auditedUnitNumbers:lineage.codes},fileHash,timeoutMs,once);
   return {...proof,registrationEditIds:lineage.editIds};
  }

 }
 return proof;
}
