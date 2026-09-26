import {demandRegistration} from '../../ocr/demand-registration';
import {assessmentMatchesDocument} from '../../ocr/invoice-assessment';
import {extractCpflPaulistaLayout} from '../../ocr/cpfl-paulista-layout';
import {extractGdEvidence} from '../../ocr/gd-evidence';
/** Scoped read-only candidates for review. This does not turn OCR into approved monthly inputs. */
export async function ocrPreparationCandidates(db:any,unit:any,month:string):Promise<{documentId:string;filename:string;canImport:false;state:string;preparation:ReturnType<typeof extractCpflPaulistaLayout>['preparation'];measurements:ReturnType<typeof extractCpflPaulistaLayout>['measurements'];gd:ReturnType<typeof extractGdEvidence>|null}[]>{
 const docs=await db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,reference_month,file_hash,file_verified,document_type,original_filename').eq('organization_id',unit.organization_id).eq('customer_id',unit.customer_id).eq('consumer_unit_id',unit.id).eq('document_type','INVOICE_DISTRIBUTOR').gte('reference_month',month+'-01').lt('reference_month',new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10)).order('id').limit(101);
 if(docs.error||!Array.isArray(docs.data)||docs.data.length>100)throw Error('Não foi possível conferir as faturas OCR desta competência.');
 if(!docs.data.length)return [];
 const results=await db.from('document_ocr_results').select('document_id,organization_id,file_hash,raw_result,evidence').eq('organization_id',unit.organization_id).in('document_id',docs.data.map((d:any)=>d.id)).limit(101);
 if(results.error||!Array.isArray(results.data)||results.data.length>100)throw Error('Não foi possível conferir as extrações desta competência.');
 return docs.data.map((doc:any)=>{
  const matches=results.data.filter((r:any)=>r.document_id===doc.id&&r.organization_id===unit.organization_id);
  const r=matches.length===1?matches[0]:null;const a=r?.evidence?.assessment;
  const valid=doc.file_verified===true&&r?.file_hash===doc.file_hash&&assessmentMatchesDocument(a,doc)&&['REVIEW_REQUIRED','REJECT_AUTOMATION'].includes(a?.intake?.decision);
  const layout=valid?extractCpflPaulistaLayout(r.raw_result):null;
  if(layout?.preparation)Object.assign(layout.preparation.demand,{registration:demandRegistration(unit,doc)});
  return {documentId:doc.id,filename:doc.original_filename,canImport:false,state:valid?a.intake.decision:'QUARANTINED',preparation:layout?.preparation??null,measurements:layout?.measurements??null,gd:valid?extractGdEvidence(r.raw_result):null};
 });
}
