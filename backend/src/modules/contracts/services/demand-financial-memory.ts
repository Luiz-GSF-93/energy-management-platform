import {demandFinancialEvidence} from '../../ocr/demand-financial-evidence';
import {demandReviewDigest} from '../../ocr/ocr-demand-review.service';
import {auditAuthorNames} from './audit-author-names';
import type {extractCpflPaulistaLayout} from '../../ocr/cpfl-paulista-layout';
type Layout=ReturnType<typeof extractCpflPaulistaLayout>;
/** Captured, scoped invoice evidence only. Never feeds approved tariff totals. */
export async function loadDemandFinancialMemory(db:any,doc:any,jobId:string,layout:Layout){
 const operations=demandFinancialEvidence(layout.operations);
 if(!operations.length||!layout.preparation)return null;
 const billed=layout.preparation.demand.billed;
 if(!jobId)throw Error('Origem da memória de demanda indisponível.');
 const result=await db.from('document_ocr_demand_reviews').select('*').eq('organization_id',doc.organization_id).eq('document_id',doc.id).order('version',{ascending:false}).limit(1001);
 if(result.error||!Array.isArray(result.data)||result.data.length>1000)throw Error('Não foi possível conferir o histórico das parcelas de demanda.');
 const reviews=await auditAuthorNames(db,doc.organization_id,result.data);
 const rows=operations.map(operation=>{
  const index=billed.findIndex(row=>row.source===operation.source),row=billed[index];
  const unique=billed.filter(r=>r.source===operation.source).length===1;
  const key=demandReviewDigest(operation.source),field={...row,key,label:'Parcela de demanda '+(index+1),state:unique&&row?row.state:'CONFLICT'};
  const snapshot={format:'ocr-demand-review-v1',layoutVersion:layout.version,jobId,document:{id:doc.id,organizationId:doc.organization_id,customerId:doc.customer_id,unitId:doc.consumer_unit_id,month:String(doc.reference_month).slice(0,7),fileHash:doc.file_hash},field};
  const sourceHash=demandReviewDigest(snapshot),history=reviews.filter(r=>r.field_key===key).sort((a,b)=>b.version-a.version),latest=history[0];
  const integrity=latest&&latest.organization_id===doc.organization_id&&latest.document_id===doc.id&&latest.source_hash===demandReviewDigest(latest.source_snapshot)&&latest.source_hash===sourceHash&&Number.isInteger(latest.version)&&latest.version>0&&history.filter(r=>r.version===latest.version).length===1;
  const confirmed=integrity&&['USED','UNUSED'].includes(latest.decision);
  return {...operation,classification:confirmed?latest.decision:'PENDING',review:confirmed?{id:latest.id,version:latest.version,author:latest.created_by_name??'Nome não disponível',createdAt:latest.created_at,sourceHash}:null};
 });
 const complete=rows.length>0&&rows.every(r=>r.state==='MATCH'&&r.classification!=='PENDING');
 const cents=complete?rows.reduce((sum,r)=>sum+BigInt(r.amount!.replace('.','')),0n):null;
 const s=cents?.toString().padStart(3,'0');
 return {version:'ocr-demand-financial-memory-1.0',state:complete?'RECONCILED':'REVIEW_REQUIRED',canImport:false as const,documentId:doc.id,fileHash:doc.file_hash,jobId,rows,total:typeof s==='string'?s.slice(0,-2)+'.'+s.slice(-2):null,message:'Memória das parcelas faturadas e classificações atuais. Valores preservados por linha; não integram os totais aprovados, não substituem demanda medida e não representam fechamento financeiro.'};
}
