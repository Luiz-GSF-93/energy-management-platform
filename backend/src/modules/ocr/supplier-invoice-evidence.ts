import {settlementHash} from './documented-supplier-settlement';
export async function collectSupplierInvoiceEvidence(documents:any[],read:(d:any)=>Promise<{kind:string;proposal:any}>){
 const kept:any[]=[],proposals:any[]=[],excluded:any[]=[],observations:string[]=[];
 if(documents.length>10)return {documents,proposals,excluded,selected:null,observations:['Há mais de dez documentos candidatos; confira as notas sem selecionar uma lista parcial.']};
 for(const d of documents){
  try{const evidence=await read(d);if(evidence.kind==='CONTRACT'){excluded.push({id:d.id,name:d.original_filename,reason:'Conteúdo contratual; não é nota fiscal.'});continue;}kept.push(d);if(evidence.proposal)proposals.push(evidence.proposal);}
  catch{kept.push(d);observations.push('Nota do fornecedor: extração local exige revisão; sem nova chamada paga.');}
 }
 return {documents:kept,proposals,excluded,observations,selected:kept.length===1&&proposals.length===1?proposals[0]:null};
}
export type SupplierInvoiceAllocation={documentId:string;fileHash:string;coverage:'FULL'|'WITH_DOCUMENTED_EXTRA';reason:string;costId?:string;costRevision?:number;costsHash?:string;taxConfirmation?:{treatment:'NET_DESTINATION_ICMS'|'INCLUDED';reason:string}};
export function supplierInvoiceAllocationInput(v:any):SupplierInvoiceAllocation{
 const uuid=(s:any)=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).filter(k=>k!=='taxConfirmation').sort().join(',')!==(v.coverage==='WITH_DOCUMENTED_EXTRA'?'costId,costRevision,costsHash,coverage,documentId,fileHash,reason':'coverage,documentId,fileHash,reason')||!uuid(v.documentId)||!/^[a-f0-9]{64}$/.test(v.fileHash??'')||!['FULL','WITH_DOCUMENTED_EXTRA'].includes(v.coverage)||typeof v.reason!=='string'||v.reason.trim().length<20||v.reason.length>1000||v.coverage==='WITH_DOCUMENTED_EXTRA'&&(!uuid(v.costId)||!Number.isInteger(v.costRevision)||v.costRevision<1||!/^[a-f0-9]{64}$/.test(v.costsHash??'')))throw Error('Confirme a cobertura e as fontes atuais da nota e de eventual compra adicional.');
 if(v.taxConfirmation!==undefined){const x=v.taxConfirmation;if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join(',')!=='reason,treatment'||!['NET_DESTINATION_ICMS','INCLUDED'].includes(x.treatment)||typeof x.reason!=='string'||x.reason.trim().length<20||x.reason.length>1000)throw Error('Confirme o tratamento fiscal da NF e sua fonte, sem presumir isenção.');}
 return {...v,reason:v.reason.trim()};
}
const scaled=(s:string)=>{if(!/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(s))throw Error();const [w,f='']=s.split('.');return BigInt(w)*10n**12n+BigInt(f.padEnd(12,'0'));};
const value=(n:bigint)=>{const a=(n<0n?-n:n).toString().padStart(13,'0');return (n<0n?'-':'')+a.slice(0,-12)+'.'+a.slice(-12);};
/** Actual invoice values take precedence over a projected contract price. No
 * contract, payment, measurement, human attestation or cost record is changed. */
export function supplierInvoiceEvidenceDraft(c:any){
 const p=c.supplierInvoiceProposal;
 if(c.manualOverrides?.supplierSettlement||c.manualOverrides?.supplierPricePerMwh!==undefined||!p||p.month!==c.month||p.format!=='supplier-invoice-proposal-1')return null;
 const requirements:any[]=[],differences:string[]=[],consumedCostSources:any[]=[],confirmedExtraCostSources:any[]=[];
 const need=(code:string,message:string,section='supply')=>requirements.push({code,message,section});
 let taxTreatment=p.taxTreatment;
 const source:any={documentId:p.documentId,fileHash:p.fileHash,kind:'VERIFIED_INVOICE',taxEvidence:p.taxEvidence};
 let difference:string|null=null;
 try{
  const measured=scaled(c.measurements.consumptionTotal)/1000n,quantity=scaled(p.quantityMwh);
  difference=value(measured-quantity);
  const confirmation=c.manualOverrides?.supplierInvoiceAllocation;
  if(confirmation){const v=supplierInvoiceAllocationInput(confirmation);if(!c.manualAuthor||v.documentId!==p.documentId||v.fileHash!==p.fileHash)throw Error('A nota mudou depois da confirmação de cobertura; confira a fonte atual.');source.allocation={...v,actor:c.manualAuthor};
   if(v.taxConfirmation){if(p.taxTreatment==='NET_DESTINATION_ICMS'&&v.taxConfirmation.treatment!=='NET_DESTINATION_ICMS')throw Error('A confirmação fiscal diverge da cláusula da NF; confira o documento.');taxTreatment=v.taxConfirmation.treatment;source.taxConfirmation={...v.taxConfirmation,actor:c.manualAuthor,documentId:p.documentId,fileHash:p.fileHash};}
  }
  if(measured!==quantity){differences.push('Quantidade faturada '+p.quantityMwh+' MWh; consumo medido '+value(measured)+' MWh; diferença '+difference+' MWh preservada, sem presumir perda ou compra extra.');if(!confirmation)need('SUPPLIER_INVOICE_COVERAGE','A NF já preenche quantidade, preço e valor. Confirme somente se cobre todo o faturamento da competência ou se existe outra nota.');}
  const items=c.cost?.costs?.items??[],supplier=items.filter((i:any)=>['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(i.category)),extra=supplier.filter((i:any)=>i.category==='SUPPLIER_EXTRA_ENERGY'),invoiceItems=supplier.filter((i:any)=>i.category==='SUPPLIER_INVOICE');
  if(confirmation?.coverage==='WITH_DOCUMENTED_EXTRA'&&(!extra.length||c.cost.id!==confirmation.costId||c.cost.revision!==confirmation.costRevision||settlementHash(c.cost.costs)!==confirmation.costsHash))throw Error('A revisão dos custos adicionais mudou; confira as fontes atuais.');
  for(const item of supplier){
   if(item.category==='SUPPLIER_EXTRA_ENERGY'){
    if(confirmation?.coverage==='WITH_DOCUMENTED_EXTRA'&&item.id&&item.scenario==='ACL'&&item.effect==='COST'&&item.taxTreatment==='INCLUDED'&&item.source?.trim()&&scaled(item.amount)>0n)confirmedExtraCostSources.push({id:item.id,costId:c.cost.id,hash:settlementHash(item)});
    else need('EXTRA_ALLOCATION_REVIEW','Existe compra adicional registrada. Confirme NF mais compra adicional e seus valores finais; a diferença de medição não substitui o documento.');
    continue;
   }
   if(invoiceItems.length!==1||item.scenario!=='ACL'||item.effect!=='COST'||!item.source?.includes(p.documentId)||!item.source?.includes(p.fileHash)||scaled(item.amount)!==scaled(p.amount))need('SUPPLIER_INVOICE_COST_CONFLICT','Concilie o lançamento do fornecedor com a NF para evitar dupla contagem.','costs');
   else consumedCostSources.push({id:item.id,costId:c.cost.id,hash:settlementHash(item)});
  }
  const noCosts=c.cost?.status==='VALIDATED'&&c.cost?.costs?.noCosts===true&&items.length===0&&c.cost?.validated_by&&c.cost?.validated_at;
  if(!items.some((i:any)=>i.category==='CCEE'&&i.scenario==='ACL')&&!noCosts&&c.cceeEstimate?.state!=='ESTIMATED')need('CCEE_COVERAGE','CCEE: informe o custo da competência ou uma fonte real anterior elegível para estimativa. Meses posteriores não substituem o histórico.','costs');
 }catch(e){need('SUPPLIER_INVOICE_REVIEW',e instanceof Error&&e.message?e.message:'Confira a quantidade e as fontes atuais da NF.');}
 if(!source.taxConfirmation&&(p.taxTreatment!=='NET_DESTINATION_ICMS'||p.taxEvidence?.kind!=='DESTINATION_ICMS'))need('SUPPLIER_INVOICE_TAX','Confirme se o valor da NF está sem ICMS (acrescentar por dentro) ou se já é o total final com tributos incluídos. A cobertura da nota já confirmada será preservada.');
 return {format:'supplier-invoice-evidence-1',state:requirements.length?'PENDING':'COMPLETE',requirements,differences,consumedCostSources,confirmedExtraCostSources,source,memory:null,terms:null,requiresHumanAcceptance:requirements.length>0,financialApproval:false,canPublish:false,supplier:{formulaVersion:'supplier-invoice-evidence-1',contract:null,pricePerMwh:p.pricePerMwh,contractedMwh:p.quantityMwh,regularAmount:p.amount,extraAmount:'0.00',totalAmount:p.amount,taxTreatment,volumeDifferenceMwh:difference,requirements:[]}};
}
