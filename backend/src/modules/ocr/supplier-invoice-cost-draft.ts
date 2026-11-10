import {resolutionId} from './ocr-resolution-plan';
export const SUPPLIER_COST_DRAFT_VERSION='supplier-cost-draft-1';
export function supplierInvoiceCostIdentity(c:any){return supplierInvoiceCostDraft(c)?{supplierCostDraftVersion:SUPPLIER_COST_DRAFT_VERSION}:{};}

/** Only exact server-verified invoice evidence may populate a monthly draft.
 * Never replace an existing supplier item, no-cost declaration or financial decision. */
export function supplierInvoiceCostDraft(c:any){
 const p=c.supplierInvoiceProposal,u=c.unit,docs=c.documentedSupplierOptions?.documents;
 if(!p||p.setVersion||p.format!=='supplier-invoice-proposal-1'||p.month!==c.month||p.installationIdentity?.matched!==true||!p.installationIdentity?.taxIdentity?.accepted||!Array.isArray(docs)||docs.length!==1||docs[0].id!==p.documentId||docs[0].file_hash!==p.fileHash||!docs[0].file_verified||!/^\d{1,12}\.\d{2}$/.test(p.amount)||Number(p.amount)<=0)return null;
 const prior=c.cost;
 if(prior&&(prior.organization_id!==u.organization_id||prior.customer_id!==u.customer_id||prior.consumer_unit_id!==u.id||prior.month!==c.month||!['DRAFT','VALIDATED'].includes(prior.status)||prior.costs?.noCosts!==false||!Array.isArray(prior.costs?.items)))return null;
 const items=prior?.costs.items??[];
 if(items.length>=100||items.some((i:any)=>['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(i.category)))return null;
 const included=p.taxTreatment==='INCLUDED'&&p.taxEvidence?.kind==='INVOICE_ICMS_INCLUDED';
 const source='NF '+p.documentId+' · SHA-256 '+p.fileHash+' · '+p.quantityMwh+' MWh × R$ '+p.pricePerMwh+'/MWh';
 return {previousId:prior?.status==='VALIDATED'?prior.id:prior?.previous_id??null,consumerUnitId:u.id,month:c.month,costs:{noCosts:false,items:[...items,{id:resolutionId(['eva-supplier-invoice-cost-v1',u.organization_id,u.id,c.month,p.documentId,p.fileHash]),label:'NF do fornecedor · '+docs[0].original_filename,category:'SUPPLIER_INVOICE',scenario:'ACL',effect:'COST',amount:p.amount,source,taxTreatment:included?'INCLUDED':'RESERVED',...(!included?{taxReservationReason:'Valor faturado preservado. ICMS e demais tributos devem seguir as fontes e confirmações fiscais da competência; sem presumir isenção.'}:{})}]},sourceReference:[prior?.source_reference,source].filter(Boolean).join(' · ').slice(0,2000),notes:((prior?.notes??'')+' · NF preenchida pela EVA; quantidade comprada e medição preservadas separadamente. Aguarda conferência financeira.').slice(0,2000),correctionReason:'Inclusão automática da NF verificada desta unidade e competência, preservando os demais custos e as publicações.'};
}
