import {settlementHash} from './documented-supplier-settlement';

const scale=1000000000000n;
const decimal=(s:string)=>{if(typeof s!=='string'||!/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(s))throw Error('Valor da NF inválido.');const [a,b='']=s.split('.');return BigInt(a)*scale+BigInt(b.padEnd(12,'0'));};
const fixed=(n:bigint,p=12)=>{const v=(n<0n?-n:n).toString().padStart(p+1,'0');return (n<0n?'-':'')+v.slice(0,-p)+'.'+v.slice(-p);};
const money=(n:bigint)=>fixed((n+scale/200n)/(scale/100n),2);

export function supplierInvoiceSetCaptureMatches(source:any,documents:any[],scope:{organizationId:string;customerId:string;unitId:string;month:string}){
 return !!source?.invoiceSetHash&&Array.isArray(source.documents)&&source.documents.length>0&&source.documents.length<=10&&source.documents.every((p:any)=>documents.some(d=>d.id===p.documentId&&d.organization_id===scope.organizationId&&d.customer_id===scope.customerId&&d.consumer_unit_id===scope.unitId&&d.file_hash===p.fileHash&&d.file_verified===true&&d.document_type==='INVOICE_SUPPLIER'&&String(d.reference_month).slice(0,7)===scope.month));
}

/** All candidates have already passed organization/unit/month and original-byte checks.
 * Do not turn a partially readable candidate list into a complete purchase. */
export function supplierInvoiceSet(documents:any[],proposals:any[]){
 if(documents.length<2||!proposals.length||documents.length>10)return null;
 const sorted=[...documents].sort((a,b)=>a.id.localeCompare(b.id));
 const sources:any[]=[],invoices:any[]=[],byKey=new Map<string,any>(),byHash=new Map<string,any>(),issues:string[]=[];
 for(const d of sorted){
  const matches=proposals.filter(p=>p.documentId===d.id&&p.fileHash===d.file_hash);
  if(matches.length!==1){if(matches.length||typeof d.id!=='string'||!/^[a-f0-9]{64}$/.test(d.file_hash??''))return null;sources.push({documentId:d.id,fileHash:d.file_hash});issues.push('Nota '+d.id+': leitura ainda não conciliada. Valores disponíveis preparados; conferir esta fonte antes de aprovar.');continue;}
  const p=matches[0];
  if(p.format!=='supplier-invoice-proposal-1'||!p.month||p.month!==proposals[0].month||!p.documentId||!/^[a-f0-9]{64}$/.test(p.fileHash))return null;
  try{if(decimal(p.quantityMwh)<=0n||decimal(p.pricePerMwh)<=0n||decimal(p.amount)<=0n)return null;}catch{return null;}
  sources.push({documentId:p.documentId,fileHash:p.fileHash});
  const key=p.fiscalIdentity?.key??p.fileHash,prior=byHash.get(p.fileHash)??byKey.get(key);
  if(prior){
   if(['quantityMwh','pricePerMwh','amount','taxTreatment'].some(k=>prior[k]!==p[k])||settlementHash(prior.taxEvidence??null)!==settlementHash(p.taxEvidence??null))issues.push('A mesma identidade fiscal apresenta valores ou tributos diferentes; confira as versões da nota.');
   continue;
  }
  byKey.set(key,p);byHash.set(p.fileHash,p);invoices.push(p);
 }
 if(!invoices.length)return null;
 const quantity=invoices.reduce((n,p)=>n+decimal(p.quantityMwh),0n),amount=invoices.reduce((n,p)=>n+decimal(p.amount),0n);
 const setHash=settlementHash({version:1,sources,invoices,issues});
 return {...invoices[0],format:'supplier-invoice-proposal-1',setVersion:1,setHash,sources,invoices,issues,
  quantityMwh:fixed(quantity),amount:money(amount),pricePerMwh:fixed((amount*1000000n+quantity/2n)/quantity,6),
  taxTreatment:'PER_INVOICE',taxEvidence:null,reviewRequired:true,financialApproval:false,
  observations:[`${invoices.length} nota(s) distinta(s) consolidada(s); valores fiscais preservados por documento. Preço médio nominal ponderado por MWh; bases tributárias podem diferir.`,...(!issues.length&&sources.length>invoices.length?['Cópias da mesma nota não foram somadas novamente.']:[])]};
}

/** Reuse the established single-invoice rules independently for every source.
 * The group's attestation is bound to its complete signature, never its first NF. */
export function supplierInvoiceSetDraft(c:any,single:(context:any)=>any,parse:(v:any)=>any){
 const p=c.supplierInvoiceProposal;if(!p?.setVersion)return null;
 const requirements:any[]=[],consumedCostSources:any[]=[],differences:string[]=[];
 const need=(code:string,message:string,section='supply')=>{if(!requirements.some(r=>r.code===code&&r.message===message))requirements.push({code,message,section});};
 let allocation=c.manualOverrides?.supplierInvoiceAllocation;
 try{if(allocation)allocation=parse(allocation);}catch{allocation=null;need('SUPPLIER_INVOICE_REVIEW','A confirmação anterior é inválida; confira o conjunto atual.');}
 if(allocation?.invoiceTaxes?.some((x:any)=>!p.invoices.some((n:any)=>n.documentId===x.documentId&&n.fileHash===x.fileHash))){allocation=null;need('SUPPLIER_INVOICE_REVIEW','Uma confirmação fiscal não pertence ao conjunto atual.');}
 const confirmed=!!c.manualAuthor&&allocation?.invoiceSetHash===p.setHash&&allocation.documentId===p.documentId&&allocation.fileHash===p.fileHash;
 if(!confirmed)need('SUPPLIER_INVOICE_COVERAGE',`As ${p.invoices.length} notas já estão preenchidas. Confirme se o conjunto cobre o faturamento ou se existe compra adicional.`);
 if(c.manualOverrides?.supplierSettlement||c.manualOverrides?.supplierPricePerMwh!==undefined)need('SUPPLIER_MANUAL_ALLOCATION_REVIEW','Há uma alocação manual anterior. Confira o conjunto antes de substituir a proposta manual.');
 for(const issue of p.issues??[])need('SUPPLIER_INVOICE_SET_CONFLICT',issue);
 if(!confirmed&&p.invoices.some((i:any)=>!i.fiscalIdentity?.key))need('SUPPLIER_INVOICE_IDENTITY','Confira se as notas sem chave fiscal reconhecida são documentos distintos; a confirmação do conjunto registrará essa conferência.');
 const components:any[]=[];
 for(const invoice of p.invoices){
  const tax=confirmed?allocation.invoiceTaxes?.find((t:any)=>t.documentId===invoice.documentId&&t.fileHash===invoice.fileHash):null;
  const current={...c,supplierInvoiceProposal:invoice,manualOverrides:{...(confirmed?{supplierInvoiceAllocation:{documentId:invoice.documentId,fileHash:invoice.fileHash,coverage:'FULL',reason:allocation.reason,...(tax?{taxConfirmation:{treatment:tax.treatment,reason:tax.reason}}:{})}}:{})},
   measurements:{...c.measurements,consumptionTotal:fixed(decimal(invoice.quantityMwh)*1000n)},cost:c.cost?{...c.cost,costs:{...c.cost.costs,items:(c.cost.costs?.items??[]).filter((i:any)=>!['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(i.category))}}:c.cost};
  const draft=single(current);
  for(const r of draft.requirements??[])if(r.code!=='SUPPLIER_INVOICE_COVERAGE')need(r.code,(r.code==='CCEE_COVERAGE'?'':invoice.documentId+': ')+r.message,r.section);
  components.push({...invoice,taxTreatment:draft.supplier.taxTreatment,taxConfirmation:draft.source.taxConfirmation??null});
 }
 const used=new Set<string>(),items=(c.cost?.costs?.items??[]).filter((i:any)=>['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(i.category));
 const confirmedExtraCostSources:any[]=[];
 for(const item of items){
  const matches=p.sources.filter((s:any)=>typeof item.source==='string'&&item.source.includes(s.documentId)&&item.source.includes(s.fileHash));
  const found=matches.length===1?p.invoices.find((i:any)=>i.fileHash===matches[0].fileHash||i.fiscalIdentity?.key&&i.fiscalIdentity.key===c.documentedSupplierOptions?.proposals?.find((x:any)=>x.documentId===matches[0].documentId)?.fiscalIdentity?.key):null;
  if(found){
   if(used.has(found.documentId)||item.scenario!=='ACL'||item.effect!=='COST'||item.supplierIcms||decimal(item.amount)!==decimal(found.amount))need('SUPPLIER_INVOICE_COST_CONFLICT','Concilie o lançamento da nota '+found.documentId+' para evitar dupla contagem.','costs');
   else{used.add(found.documentId);consumedCostSources.push({id:item.id,costId:c.cost.id,hash:settlementHash(item)});}
  }else if(!matches.length&&!p.sources.some((s:any)=>typeof item.source==='string'&&(item.source.includes(s.documentId)||item.source.includes(s.fileHash)))&&confirmed&&allocation.coverage==='WITH_DOCUMENTED_EXTRA'&&allocation.costId===c.cost?.id&&allocation.costRevision===c.cost?.revision&&allocation.costsHash===settlementHash(c.cost?.costs)&&item.category==='SUPPLIER_EXTRA_ENERGY'&&item.scenario==='ACL'&&item.effect==='COST'&&item.taxTreatment==='INCLUDED'&&!item.supplierIcms&&item.source?.trim()&&decimal(item.amount)>0n){confirmedExtraCostSources.push({id:item.id,costId:c.cost.id,hash:settlementHash(item)});}
  else need('EXTRA_ALLOCATION_REVIEW','Existe compra registrada fora do conjunto de NFs; confira a cobertura e a fonte antes de aprovar.','costs');
 }
 if(confirmed&&allocation.coverage==='WITH_DOCUMENTED_EXTRA'&&!confirmedExtraCostSources.length)need('EXTRA_ALLOCATION_REVIEW','A compra adicional não está comprovada na revisão atual dos custos.','costs');
 let difference:null|string=null;
 try{const measured=decimal(c.measurements.consumptionTotal)/1000n;difference=fixed(measured-decimal(p.quantityMwh));differences.push('Notas: '+p.quantityMwh+' MWh; medição: '+fixed(measured)+' MWh; diferença '+difference+' MWh preservada, sem presumir perda ou compra extra.');}catch{need('SUPPLIER_INVOICE_REVIEW','Confira a medição da competência.');}
 return {format:'supplier-invoice-evidence-1',setVersion:1,state:requirements.length?'PENDING':'COMPLETE',requirements,differences,consumedCostSources,confirmedExtraCostSources,memory:null,terms:null,
  source:{kind:'VERIFIED_INVOICE',documentId:p.documentId,fileHash:p.fileHash,invoiceSetHash:p.setHash,documents:p.sources,invoices:components,...(confirmed?{allocation:{...allocation,actor:c.manualAuthor}}:{})},
  requiresHumanAcceptance:requirements.length>0,financialApproval:false,canPublish:false,
  supplier:{formulaVersion:'supplier-invoice-evidence-1',contract:null,pricePerMwh:p.pricePerMwh,contractedMwh:p.quantityMwh,regularAmount:p.amount,extraAmount:'0.00',totalAmount:p.amount,taxTreatment:'PER_INVOICE',invoiceComponents:components,volumeDifferenceMwh:difference,requirements:[]}};
}
