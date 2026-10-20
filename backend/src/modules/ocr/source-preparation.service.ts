import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {extractPdfText} from './eva-pdf-text.extractor';
import {contractAnnexEvidence,sourcePreparationEnabled,sameContractDecimal,contractPartyMatches} from './source-preparation-v3';
import {invoiceIdentityPreflight} from './invoice-identity-preflight';

/** Read-only local extraction. Caller has already checked backoffice permissions,
 * entitlements and the selected tenant/unit. No provider, OCR or financial write. */
@Injectable()
export class SourcePreparationService{
 constructor(private readonly db:SupabaseService){}
 private readonly identities=new Map<string,{until:number;value:Awaited<ReturnType<typeof invoiceIdentityPreflight>>}>();
 private readonly extracted=new Map<string,{until:number;value:Awaited<ReturnType<typeof extractPdfText>>}>();
 private async text(d:any){
  const org=d.organization_id,unit=d.consumer_unit_id;
  if(d.file_verified!==true||d.storage_bucket!=='energy-documents-private'||!d.file_path?.startsWith(org+'/'+unit+'/')||d.file_path.split('/').some((p:string)=>!p||p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(d.file_hash??'')||!Number.isSafeInteger(d.file_size_bytes)||d.file_size_bytes<20||d.file_size_bytes>15*1024*1024)throw new ServiceUnavailableException('Documento sem metadados íntegros.');
  const file=await this.db.getClient().storage.from(d.storage_bucket).download(d.file_path);
  if(file.error||!file.data||file.data.size!==d.file_size_bytes)throw new ServiceUnavailableException('Documento indisponível; nenhuma referência parcial.');
  const bytes=Buffer.from(await file.data.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==d.file_hash)throw new ServiceUnavailableException('O documento mudou. Reconfira a fonte.');
  return bytes;
 }
 async invoiceIdentity(org:string,customer:string,unit:string,document:string,registration:any){
  if(!sourcePreparationEnabled())return null;
  const r=await this.db.getClient().from('documents').select('*').eq('organization_id',org).eq('customer_id',customer).eq('consumer_unit_id',unit).eq('id',document).eq('document_type','INVOICE_DISTRIBUTOR').maybeSingle();
  if(r.error||!r.data||r.data.organization_id!==org||r.data.customer_id!==customer||r.data.consumer_unit_id!==unit)throw new ServiceUnavailableException('Não foi possível conferir a identidade no original.');
  const bytes=await this.text(r.data);
  const key=createHash('sha256').update(JSON.stringify([org,customer,unit,document,r.data.file_hash,registration])).digest('hex'),cached=this.identities.get(key);
  if(cached&&cached.until>Date.now())return structuredClone(cached.value);
  const proof=await invoiceIdentityPreflight(bytes,'application/pdf',registration,r.data.file_hash,8000);
  if(['MATCH','MISMATCH'].includes(proof.state)){if(this.identities.size>=16)this.identities.delete(this.identities.keys().next().value!);this.identities.set(key,{until:Date.now()+60000,value:structuredClone(proof)});}
  return proof;
 }
 async inspect(c:any){
  if(!sourcePreparationEnabled())return null;
  const invoiceIdentity=c.originalIdentity?{state:c.originalIdentity.state,checks:c.originalIdentity.checks,fileHash:c.originalIdentity.fileHash,sourcePages:c.originalIdentity.sourcePages??[]}:null;
  const org=c.unit.organization_id,customer=c.unit.customer_id,unit=c.unit.id;
  const contracts=(c.captured.contracts??[]).filter((r:any)=>r.organization_id===org&&r.customer_id===customer&&r.consumer_unit_id===unit&&r.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(r.status)&&String(r.start_date).slice(0,10)<=c.period.start&&String(r.end_date??'9999-12-31').slice(0,10)>=c.period.end);
  if(contracts.length!==1)return {version:3,invoiceIdentity,state:'REVIEW',observations:['Contrato vigente único não identificado para consultar o anexo.'],documents:[]};
  const db=this.db.getClient(),r=await db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,energy_contract_id,document_type,original_filename,file_verified,file_hash,file_size_bytes,storage_bucket,file_path').eq('organization_id',org).eq('customer_id',customer).eq('consumer_unit_id',unit).eq('file_verified',true).or('document_type.eq.CONTRACT_ENERGY,original_filename.ilike.*contrat*,original_filename.ilike.*minuta*,original_filename.ilike.*anexo*').limit(101);
  if(r.error||!Array.isArray(r.data)||r.data.length>100)throw new ServiceUnavailableException('Não foi possível conferir os anexos contratuais completos.');
  // Some historic contract PDFs were registered as supplier invoices. Their name
  // only discovers candidates; it never proves a contractual link or a price.
  const discovered=r.data.filter((d:any)=>(!d.energy_contract_id||d.energy_contract_id===contracts[0].id)&&(d.document_type==='CONTRACT_ENERGY'||/\b(contrat|minuta|anexo)/i.test(d.original_filename??''))&&/\.pdf$/i.test(d.original_filename??''));
  const linked=discovered.filter((d:any)=>d.energy_contract_id===contracts[0].id),docs=linked.length?linked:discovered;
  if(docs.length>4)return {version:3,invoiceIdentity,state:'REVIEW',observations:['Mais de quatro candidatos contratuais; conferir o vínculo antes da extração.'],documents:[]};
  const evidence:any[]=[],deadline=Date.now()+12000;
  for(const d of docs){
   if(d.organization_id!==org||d.customer_id!==customer||d.consumer_unit_id!==unit||d.file_verified!==true||d.storage_bucket!=='energy-documents-private'||!d.file_path?.startsWith(org+'/'+unit+'/')||d.file_path.split('/').some((p:string)=>!p||p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(d.file_hash??'')||!Number.isSafeInteger(d.file_size_bytes)||d.file_size_bytes<20||d.file_size_bytes>15*1024*1024)throw new ServiceUnavailableException('Anexo contratual sem metadados íntegros.');
   if(Date.now()+1000>deadline){evidence.push({documentId:d.id,sourceHash:d.file_hash,contractId:contracts[0].id,link:'CANDIDATE_REQUIRES_REVIEW',annex:{state:'REVIEW',reason:'Limite de tempo da extração local atingido; sem chamada paga automática.'},conflicts:[]});continue;}
   const file=await db.storage.from(d.storage_bucket).download(d.file_path);
   if(file.error||!file.data||file.data.size!==d.file_size_bytes)throw new ServiceUnavailableException('Anexo contratual indisponível; nenhuma referência parcial.');
   const bytes=Buffer.from(await file.data.arrayBuffer());
   if(createHash('sha256').update(bytes).digest('hex')!==d.file_hash)throw new ServiceUnavailableException('O anexo contratual mudou. Reconfira a fonte.');
   try{
    const key=[org,customer,unit,d.id,d.file_hash].join(':'),cached=this.extracted.get(key);
    const extracted=cached&&cached.until>Date.now()?cached.value:await extractPdfText(bytes,Math.max(1000,Math.min(8000,deadline-Date.now()))),annex=contractPartyMatches(extracted.sections,c.originalIdentity?.registration?.taxId)?contractAnnexEvidence(extracted.sections,c.month):{state:'REVIEW' as const,reason:'CNPJ do cliente não comprovado no texto do contrato/anexo. Conferir o vínculo documental.',sources:[]};
    if(!cached||cached.until<=Date.now()){if(this.extracted.size>=8)this.extracted.delete(this.extracted.keys().next().value!);this.extracted.set(key,{until:Date.now()+60000,value:extracted});}
    const conflicts:string[]=[];const terms='volumeTerms' in annex?annex.volumeTerms:null,contract=contracts[0];
    if(terms&&!sameContractDecimal(contract.contracted_volume_mwh,terms.contractedMwh))conflicts.push('Volume cadastrado diverge da conversão MW médio × horas da competência.');
    if(terms&&!sameContractDecimal(contract.flexibility_max_percent,terms.maxPercent))conflicts.push('Limite superior informativo cadastrado diverge do percentual total do anexo (fator × 100).');
    const billing=(c.captured.billingRules??[]).filter((r:any)=>r.organization_id===org&&r.customer_id===customer&&r.consumer_unit_id===unit&&r.contract_id===contract.id&&String(r.start_date).slice(0,10)<=c.period.start&&String(r.end_date).slice(0,10)>=c.period.end).sort((a:any,b:any)=>b.version-a.version)[0];
    if(terms&&billing&&(!sameContractDecimal(billing.min_percent,terms.minPercent)||!sameContractDecimal(billing.max_tolerance_percent,terms.maxTolerancePercent)))conflicts.push('Condição de faturamento diverge dos limites normalizados: mínimo sobre o volume e tolerância adicionada a 100%.');
    if('modulation' in annex&&annex.modulation==='FLAT'&&contract.modulation!=='FLAT')conflicts.push('Modulação cadastrada diverge de Flat no anexo.');
    evidence.push({documentId:d.id,sourceHash:d.file_hash,contractId:contract.id,link:d.energy_contract_id===contract.id?'REGISTERED_CONTRACT_DOCUMENT':'CANDIDATE_REQUIRES_REVIEW',annex,conflicts});
   }catch{evidence.push({documentId:d.id,sourceHash:d.file_hash,contractId:contracts[0].id,link:'CANDIDATE_REQUIRES_REVIEW',annex:{state:'REVIEW',reason:'Extração local indisponível; sem chamada paga automática.'},conflicts:[]});}
  }
  return {version:3,invoiceIdentity,state:'REVIEW',documents:evidence,observations:['Anexos consultados sem alterar o contrato. Preço-base não substitui preço reajustado, vínculo confirmado ou nota fiscal.'],automaticFinancialApproval:false};
 }
}
