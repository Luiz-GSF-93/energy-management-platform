import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {extractPdfText} from './eva-pdf-text.extractor';
import {contractAnnexEvidence,sourcePreparationEnabled} from './source-preparation-v3';
import {invoiceIdentityPreflight} from './invoice-identity-preflight';

/** Read-only local extraction. Caller has already checked backoffice permissions,
 * entitlements and the selected tenant/unit. No provider, OCR or financial write. */
@Injectable()
export class SourcePreparationService{
 constructor(private readonly db:SupabaseService){}
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
  return invoiceIdentityPreflight(bytes,'application/pdf',registration,r.data.file_hash);
 }
 async inspect(c:any){
  if(!sourcePreparationEnabled())return null;
  const org=c.unit.organization_id,customer=c.unit.customer_id,unit=c.unit.id;
  const contracts=(c.captured.contracts??[]).filter((r:any)=>r.organization_id===org&&r.customer_id===customer&&r.consumer_unit_id===unit&&r.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(r.status)&&String(r.start_date).slice(0,10)<=c.period.start&&String(r.end_date??'9999-12-31').slice(0,10)>=c.period.end);
  if(contracts.length!==1)return {version:3,state:'REVIEW',observations:['Contrato vigente único não identificado para consultar o anexo.'],documents:[]};
  const db=this.db.getClient(),r=await db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,document_type,original_filename,file_verified,file_hash,file_size_bytes,storage_bucket,file_path').eq('organization_id',org).eq('customer_id',customer).eq('consumer_unit_id',unit).eq('file_verified',true).limit(101);
  if(r.error||!Array.isArray(r.data)||r.data.length>100)throw new ServiceUnavailableException('Não foi possível conferir os anexos contratuais completos.');
  // Some historic contract PDFs were registered as supplier invoices. Their name
  // only discovers candidates; it never proves a contractual link or a price.
  const docs=r.data.filter((d:any)=>/\b(contrat|minuta|anexo)/i.test(d.original_filename??'')&&/\.pdf$/i.test(d.original_filename??''));
  if(docs.length>4)return {version:3,state:'REVIEW',observations:['Mais de quatro candidatos contratuais; conferir o vínculo antes da extração.'],documents:[]};
  const evidence:any[]=[];
  for(const d of docs){
   if(d.organization_id!==org||d.customer_id!==customer||d.consumer_unit_id!==unit||d.storage_bucket!=='energy-documents-private'||!d.file_path?.startsWith(org+'/'+unit+'/')||d.file_path.split('/').some((p:string)=>!p||p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(d.file_hash??'')||!Number.isSafeInteger(d.file_size_bytes)||d.file_size_bytes<20||d.file_size_bytes>15*1024*1024)throw new ServiceUnavailableException('Anexo contratual sem metadados íntegros.');
   const file=await db.storage.from(d.storage_bucket).download(d.file_path);
   if(file.error||!file.data||file.data.size!==d.file_size_bytes)throw new ServiceUnavailableException('Anexo contratual indisponível; nenhuma referência parcial.');
   const bytes=Buffer.from(await file.data.arrayBuffer());
   if(createHash('sha256').update(bytes).digest('hex')!==d.file_hash)throw new ServiceUnavailableException('O anexo contratual mudou. Reconfira a fonte.');
   try{
    const key=[org,customer,unit,d.id,d.file_hash].join(':'),cached=this.extracted.get(key);
    const extracted=cached&&cached.until>Date.now()?cached.value:await extractPdfText(bytes),annex=contractAnnexEvidence(extracted.sections,c.month);
    if(!cached||cached.until<=Date.now()){if(this.extracted.size>=8)this.extracted.delete(this.extracted.keys().next().value!);this.extracted.set(key,{until:Date.now()+60000,value:extracted});}
    const conflicts:string[]=[];const terms='volumeTerms' in annex?annex.volumeTerms:null,contract=contracts[0];
    if(terms&&String(contract.contracted_volume_mwh)!==terms.contractedMwh)conflicts.push('Volume cadastrado diverge da conversão MW médio × horas da competência.');
    if(terms&&Number(contract.flexibility_max_percent)!==Number(terms.maxTolerancePercent))conflicts.push('Limite superior cadastrado diverge da tolerância normalizada do anexo.');
    if('modulation' in annex&&annex.modulation==='FLAT'&&contract.modulation!=='FLAT')conflicts.push('Modulação cadastrada diverge de Flat no anexo.');
    evidence.push({documentId:d.id,sourceHash:d.file_hash,contractId:contract.id,link:'CANDIDATE_REQUIRES_REVIEW',annex,conflicts});
   }catch{evidence.push({documentId:d.id,sourceHash:d.file_hash,contractId:contracts[0].id,link:'CANDIDATE_REQUIRES_REVIEW',annex:{state:'REVIEW',reason:'Extração local indisponível; sem chamada paga automática.'},conflicts:[]});}
  }
  return {version:3,state:'REVIEW',documents:evidence,observations:['Anexos consultados sem alterar o contrato. Preço-base não substitui preço reajustado, vínculo confirmado ou nota fiscal.'],automaticFinancialApproval:false};
 }
}
