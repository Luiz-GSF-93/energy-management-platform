import {ServiceUnavailableException} from '@nestjs/common';
import {invoiceIdentityPreflight,auditedUnitCodeHistory,InvoiceRegistration} from './invoice-identity-preflight';
import {sourcePreparationEnabled} from './source-preparation-v3';

/** Exact audited aliases only; shared by the first read and subsequent source inspections. */
export async function invoiceIdentityWithHistory(db:any,bytes:Buffer,mime:string,registration:InvoiceRegistration,fileHash:string,scope:{org:string;customer:string;unit:string},timeoutMs?:number){
 const clean=Object.fromEntries(['customerName','taxId','unitNumber','address','month'].map(k=>[k,registration[k as keyof InvoiceRegistration]])) as InvoiceRegistration;
 let proof=await invoiceIdentityPreflight(bytes,mime,clean,fileHash,timeoutMs);
 if(sourcePreparationEnabled()&&proof.state==='MISMATCH'&&'unit' in proof.checks&&proof.checks.unit==='MISMATCH'){
  const history=await db.from('registration_edits').select('*').eq('organization_id',scope.org).eq('entity_kind','consumer_units').eq('entity_id',scope.unit).order('created_at',{ascending:false}).limit(100);
  if(history.error||!Array.isArray(history.data))throw new ServiceUnavailableException('Não foi possível conferir o histórico auditado da unidade.');
  const lineage=auditedUnitCodeHistory(history.data,scope.org,scope.customer,scope.unit,clean.unitNumber??'');
  if(lineage.editIds.length){
   proof=await invoiceIdentityPreflight(bytes,mime,{...clean,auditedUnitNumbers:lineage.codes},fileHash,timeoutMs);
   return {...proof,registrationEditIds:lineage.editIds};
  }
 }
 return proof;
}
