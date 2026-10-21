import {indexMemoryParameters,indexMemoryPlan,indexMemoryHash,parseOfficialIpca,calculateIndexMemory} from '../contracts/services/contract-index-memory.model';
import {sameContractDecimal} from './source-preparation-v3';
export const CONTRACT_CLOSING_DRAFT_FLAG='EVA_CONTRACT_CLOSING_DRAFTS_ENABLED';
export const contractClosingDraftEnabled=()=>process.env[CONTRACT_CLOSING_DRAFT_FLAG]==='true';
const day=(v:unknown)=>String(v??'').slice(0,10),hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const autofillHash=indexMemoryHash;
const dec=(v:unknown)=>{const s=String(v);if(!/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(s))throw Error('Decimal sem fonte.');const [a,b='']=s.split('.');return BigInt(a)*10n**12n+BigInt(b.padEnd(12,'0'));};
const fixed=(v:bigint,p=12)=>{const a=v.toString().padStart(p+1,'0');return a.slice(0,-p)+'.'+a.slice(-p);};
const money=(volume:bigint,price:bigint)=>fixed((volume*price*100n+10n**24n/2n)/(10n**24n),2);
/** An isolated source-backed proposal, never an edit of the registered contract. */
export function contractClosingDraft(c:any,memories:any[]){
 const r:any={format:'eva-contract-closing-draft-1',month:c.month,state:'PENDING',contractId:null,source:null,terms:null,memory:null,supplier:null,consumedCostSources:[],differences:[],requirements:[],requiresHumanAcceptance:true,financialApproval:false,canPublish:false};
 const need=(code:string,message:string,section='supply')=>r.requirements.push({code,message,section});
 const unit=c.unit,period=c.period,scoped=(x:any)=>x.organization_id===unit.organization_id&&x.customer_id===unit.customer_id&&x.consumer_unit_id===unit.id;
 if(!(c.ready||c.proposalReady)||c.originalIdentity?.state!=='MATCH'||c.originalIdentity?.fileHash!==c.document?.file_hash){need('IDENTITY_SOURCE','Identidade e conciliação da fatura precisam estar comprovadas.','documents');return r;}
 const contracts=(c.captured?.contracts??[]).filter((x:any)=>scoped(x)&&x.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(x.status)&&day(x.start_date)<=period.end&&day(x.end_date)>=period.start);
 if(unit.free_market!==true||contracts.length!==1||day(contracts[0].start_date)>period.start||day(contracts[0].end_date)<period.end){need('CONTRACT_SCOPE','Enquadramento ACL e contrato de compra único cobrindo toda a competência precisam estar comprovados.');return r;}
 const contract=contracts[0];r.contractId=contract.id;
 if(Array.isArray(contract.seasonal_volumes)&&contract.seasonal_volumes.some((s:any)=>s.year===Number(c.month.slice(0,4))))need('SEASONAL_SOURCE','Há distribuição sazonal registrada para o ano. Concilie sua fonte com o volume constante do anexo antes de usar a proposta mensal.');
 const docs=(c.sourcePreparation?.documents??[]).filter((d:any)=>d.contractId===contract.id&&d.link==='REGISTERED_CONTRACT_DOCUMENT'&&d.annex?.state==='PROPOSED'&&hash(d.sourceHash)&&d.annex.sources?.length===1&&hash(d.annex.sources[0].sectionHash));
 if(docs.length!==1){need('ANNEX_SCOPE','Anexo verificado e vinculado ao contrato não identificado de forma única.');return r;}
 const doc=docs[0],a=doc.annex;
 r.source={documentId:doc.documentId,fileHash:doc.sourceHash,pages:a.sources,contractHash:autofillHash(contract)};r.differences=[...(doc.conflicts??[])];
 if(r.differences.some((s:unknown)=>typeof s!=='string'||!/^(Volume cadastrado|Modulação cadastrada|Limite superior informativo cadastrado|Condição de faturamento diverge)/.test(s)))need('ANNEX_UNRESOLVED','Há divergência contratual sem regra de proposta comprovada. Confira o documento.');
 if(!a.volumeTerms||a.volumeTerms.volumeBasis!=='MONTHLY'||a.volumeTerms.originUnit!=='MW_AVERAGE'||a.volumeTerms.hours!==Number(period.end.slice(8,10))*24||!a.period||a.period.start>period.start||a.period.end<period.end||a.modulation!=='FLAT'||!a.price||!a.adjustment||a.index!=='IPCA/IBGE'){need('ANNEX_TERMS','Preço-base, reajuste, volume, flexibilidade, vigência e modulação precisam estar demonstrados no anexo desta competência.');return r;}
 r.terms={...a.volumeTerms,modulation:a.modulation,basePrice:a.price,adjustment:a.adjustment};
 const supplier:any={formulaVersion:'annex-draft-supplier-1.0',contract:{id:contract.id,number:contract.contract_number},rule:null,pricePerMwh:null,contractedMwh:a.volumeTerms.contractedMwh,minMwh:null,maxMwh:null,regularAmount:null,extraAmount:null,totalAmount:null,taxTreatment:null,requirements:r.requirements};r.supplier=supplier;
 const rows=memories.filter(m=>scoped(m)&&m.contract_id===contract.id&&m.parameters?.month===c.month).sort((x,y)=>y.version-x.version);
 const memory=rows[0];
 if(!memory||memory.state!=='COMPLETE'){need('INDEX_MEMORY_REQUIRED','Conclua a memória IPCA desta competência com autorização específica da fonte/período. A prévia ou autorização expirada não comprova o índice.');}
 else try{
  if(rows.filter(m=>m.version===memory.version).length!==1||!Number.isInteger(memory.version)||[memory.created_at,memory.consent_at,memory.expires_at,memory.finished_at].some(v=>typeof v!=='string'||!Number.isFinite(Date.parse(v)))||!memory.created_by||!memory.consent_note?.trim()||Date.parse(memory.consent_at)>Date.parse(memory.expires_at)||Date.parse(memory.consent_at)<Date.parse(memory.created_at)||Date.parse(memory.finished_at)<Date.parse(memory.consent_at)||autofillHash(memory.contract_snapshot)!==autofillHash(contract)||memory.source_document?.id!==doc.documentId||memory.source_document?.fileHash!==doc.sourceHash)throw Error();
  const p=indexMemoryParameters(memory.parameters),plan=indexMemoryPlan(p),evidence=memory.result?.evidence;
  if(p.sourceDocumentId!==doc.documentId||!sameContractDecimal(p.basePrice,a.price)||p.baseDate!==a.adjustment.baseDate||p.firstAdjustment!==a.adjustment.firstAdjustment||p.frequencyMonths!==a.adjustment.frequencyMonths||indexMemoryHash(plan)!==indexMemoryHash(memory.plan))throw Error();
  let indices:Record<string,string>={};
  if(plan.due){if(!evidence||evidence.url!==plan.url||!Number.isFinite(Date.parse(evidence.retrievedAt))||Date.parse(evidence.retrievedAt)<Date.parse(memory.consent_at)-60000||Date.parse(evidence.retrievedAt)>Date.parse(memory.finished_at)||indexMemoryHash(evidence.data)!==evidence.sha256)throw Error();indices=parseOfficialIpca(evidence.data,plan);}
  const calculation=calculateIndexMemory(p,indices,contract.current_price);
  if(autofillHash(calculation)!==autofillHash(memory.result.calculation)||memory.result.financialApplication!==false)throw Error();
  supplier.pricePerMwh=calculation.pricePerMwh;supplier.priceSource='Memória IPCA '+memory.id+' v'+memory.version;
  r.memory={id:memory.id,version:memory.version,hash:autofillHash(memory),pricePerMwh:calculation.pricePerMwh,evidence:evidence?{url:evidence.url,sha256:evidence.sha256,retrievedAt:evidence.retrievedAt}:null};
 }catch{need('INDEX_MEMORY_INVALID','Memória de reajuste divergente do contrato/anexo, fórmula, fonte ou período. Prepare nova revisão autorizada.');}
 try{
  const volume=dec(a.volumeTerms.contractedMwh),minimum=volume*dec(a.volumeTerms.minPercent)/(100n*10n**12n),maximum=volume*(100n*10n**12n+dec(a.volumeTerms.maxTolerancePercent))/(100n*10n**12n),consumed=dec(c.measurements.consumptionTotal)/1000n;
  if(volume===0n||dec(a.volumeTerms.minPercent)>100n*10n**12n||dec(a.volumeTerms.maxPercent)!==100n*10n**12n+dec(a.volumeTerms.maxTolerancePercent)||maximum<minimum||dec(c.measurements.consumptionPeak)+dec(c.measurements.consumptionOffPeak)!==dec(c.measurements.consumptionTotal))throw Error();
  const billed=consumed<minimum?minimum:consumed>maximum?maximum:consumed,extra=consumed>maximum?consumed-maximum:0n;
  Object.assign(supplier,{minMwh:fixed(minimum),maxMwh:fixed(maximum),consumedMwh:fixed(consumed),billedMwh:fixed(billed),extraMwh:fixed(extra)});
  if(supplier.pricePerMwh!==null)supplier.regularAmount=money(billed,dec(supplier.pricePerMwh));
  const rules=(c.captured.billingRules??[]).filter((x:any)=>scoped(x)&&x.contract_id===contract.id&&day(x.start_date)<=period.end&&day(x.end_date)>=period.start).sort((x:any,y:any)=>y.version-x.version),rule=rules[0];
  if(rule&&rule.id&&Number.isInteger(rule.version)&&rule.version>0&&day(rule.start_date)<=period.start&&day(rule.end_date)>=period.end&&rules.filter((x:any)=>x.version===rule.version).length===1&&rule.source?.trim()&&rule.tax_treatment==='GROSS'){supplier.taxTreatment='GROSS';supplier.rule={id:rule.id,version:rule.version,source:rule.source};}
  else need('SUPPLIER_TAX_SOURCE','Composição fiscal final do fornecedor ainda não comprovada. Confirme a cláusula ou condição estruturada desta competência; não presumir isenção ou preço bruto.');
  const cost=c.cost,items=cost?.costs?.items??[],validCost=cost&&scoped(cost)&&cost.month===c.month&&['DRAFT','VALIDATED'].includes(cost.status)&&cost.created_by&&cost.source_reference?.trim();
  const extras=validCost?items.filter((i:any)=>i.scenario==='ACL'&&i.category==='SUPPLIER_EXTRA_ENERGY'):[];
  if(extra===0n){supplier.extraAmount='0.00';if(extras.length)need('EXTRA_UNEXPECTED','Há compra extra registrada sem excedente calculado. Concilie a origem antes de totalizar.','costs');}
  else if(!extras.length)need('EXTRA_PURCHASE','Compra extra de '+fixed(extra)+' MWh precisa de valor, condição fiscal e fonte desta competência. A energia regular não cobre o total.','costs');
  else if(supplier.taxTreatment!=='GROSS'||extras.some((i:any)=>!i.id||!i.source?.trim()||i.taxTreatment!=='INCLUDED'||!['COST','CREDIT'].includes(i.effect)))need('EXTRA_TAX','Compra extra e fornecedor precisam de composição fiscal final compatível e fonte.','costs');
  else{let sum=0n;for(const i of extras){const value=dec(i.amount);if(value%(10n**10n)!==0n)throw Error();sum+=(i.effect==='CREDIT'?-1n:1n)*value;}if(sum<0n)throw Error();supplier.extraAmount=fixed(sum/(10n**10n),2);r.consumedCostSources=extras.map((i:any)=>({id:i.id,hash:autofillHash(i),costId:cost.id}));}
 const ccee=validCost?items.filter((i:any)=>i.scenario==='ACL'&&i.category==='CCEE'&&i.id&&i.source?.trim()&&i.taxTreatment==='INCLUDED'&&['COST','CREDIT'].includes(i.effect)&&dec(i.amount)%(10n**10n)===0n):[];
 if(new Set(items.map((i:any)=>i.id)).size!==items.length)throw Error();
  if(!ccee.length&&!(validCost&&cost.status==='VALIDATED'&&cost.costs.noCosts===true&&items.length===0&&cost.validated_by&&cost.validated_at))need('CCEE_COVERAGE','Custos CCEE desta competência não comprovados; vincule o extrato/registro ou declaração validada de não aplicação. Ausência não é valor zero.','costs');
  if(supplier.regularAmount!==null&&supplier.extraAmount!==null)supplier.totalAmount=fixed((dec(supplier.regularAmount)+dec(supplier.extraAmount))/(10n**10n),2);
 }catch{need('MONTHLY_MEASUREMENTS','Quantidades ou custos da competência ainda não conciliados.','monthly');}
 r.state=r.requirements.length?'PENDING':'COMPLETE';return r;
}
