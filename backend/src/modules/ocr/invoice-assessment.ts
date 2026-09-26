import { assessInvoiceIntake } from './invoice-intake';
export function assessmentMatchesDocument(assessment:any,doc:any):boolean {
 const s=assessment?.source;
 return assessment?.version==='intake-assessment-v1'&&s?.organizationId===doc.organization_id&&s.documentId===doc.id&&s.fileHash===doc.file_hash&&s.customerId===doc.customer_id&&s.unitId===doc.consumer_unit_id&&s.referenceMonth===String(doc.reference_month??'').slice(0,7);
}
/** Snapshot and decision are persisted atomically with the immutable provider result. */
export async function captureInvoiceAssessment(db:any,job:any,raw:Record<string,any>){
 const source=await db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,reference_month,file_hash,document_type,file_verified').eq('organization_id',job.organization_id).eq('id',job.document_id).maybeSingle();
 const doc=source.data;
 if(source.error||!doc||doc.file_hash!==job.file_hash||doc.file_verified!==true||doc.document_type!=='INVOICE_DISTRIBUTOR')throw new Error('OCR_SOURCE_ASSESSMENT_PENDING');
 const [customer,unit,duplicates]=await Promise.all([
  db.from('customers').select('company_name,document').eq('organization_id',job.organization_id).eq('id',doc.customer_id).is('deleted_at',null).maybeSingle(),
  db.from('consumer_units').select('consumer_unit_number,address,free_market').eq('organization_id',job.organization_id).eq('id',doc.consumer_unit_id).eq('customer_id',doc.customer_id).maybeSingle(),
  db.from('documents').select('id').eq('organization_id',job.organization_id).eq('consumer_unit_id',doc.consumer_unit_id).eq('reference_month',doc.reference_month).eq('document_type','INVOICE_DISTRIBUTOR').neq('id',doc.id).limit(1),
 ]);
 if(customer.error||unit.error||duplicates.error)throw new Error('OCR_REGISTRATION_ASSESSMENT_PENDING');
 const context={customer:customer.data,unit:unit.data,referenceMonth:String(doc.reference_month??'').slice(0,7),otherDocumentInPeriod:!!duplicates.data?.length};
 return {version:'intake-assessment-v1',checkedAt:new Date().toISOString(),source:{organizationId:job.organization_id,documentId:doc.id,fileHash:doc.file_hash,customerId:doc.customer_id,unitId:doc.consumer_unit_id,referenceMonth:context.referenceMonth},registration:context,intake:assessInvoiceIntake(raw,context)};
}
