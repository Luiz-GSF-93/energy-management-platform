import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {INDEX_MEMORY_FLAG,indexMemoryParameters,indexMemoryPlan,indexMemoryHash,parseOfficialIpca,calculateIndexMemory} from './contract-index-memory.model';
import {createHash} from 'node:crypto';
import {extractPdfText} from '../../ocr/eva-pdf-text.extractor';
import {contractAnnexEvidence} from '../../ocr/source-preparation-v3';
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
@Injectable()
export class ContractIndexMemoryService{
 constructor(private db:SupabaseService,private licenses:LicensesService,private config:ConfigService){}
 private enabled(){return this.config.get(INDEX_MEMORY_FLAG)==='true';}
 private async rpc(action:string,contract:string,id:string|null,body:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Memória de reajustes ainda não habilitada.');
  if(!uuid(contract)||!t?.organizationId||!t.userId||!t.roleId)throw new ForbiddenException('Contexto interno de contratos necessário.');
  await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  const r=await this.db.getClient().rpc('contract_index_memory_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_contract:contract,p_action:action,p_id:id,p_body:body});
  if(!r.error&&r.data!=null)return r.data;
  if(r.error?.code==='42501')throw new ForbiddenException('Acesso restrito à equipe interna autorizada.');
  if(['40001','23505'].includes(r.error?.code))throw new ConflictException('A fonte, revisão ou validade mudou. Atualize o histórico e prepare nova memória.');
  if(r.error?.code==='22023')throw new BadRequestException('Confira parâmetros, vigência, fonte e autorização.');
  throw new ServiceUnavailableException('Resultado não confirmado. Consulte o histórico antes de repetir.');
 }
 async history(q:any,t:TenantContext){
  if(!q||Object.keys(q).join(',')!=='contractId'||!uuid(q.contractId))throw new BadRequestException('Contrato inválido.');
  if(!this.enabled())return {enabled:false,rows:[],canWrite:false};
  return {enabled:true,...await this.rpc('history',q.contractId,null,{},t)};
 }
 async preview(b:any,t:TenantContext){
  if(!b||Object.keys(b).sort().join(',')!=='contractId,parameters,previousId,requestId'||!uuid(b.contractId)||!uuid(b.requestId)||!(b.previousId===null||uuid(b.previousId)))throw new BadRequestException('Memória inválida.');
  let parameters:ReturnType<typeof indexMemoryParameters>;
  try{parameters=indexMemoryParameters(b.parameters);}catch(e){throw new BadRequestException((e as Error).message);}
  const h=await this.rpc('history',b.contractId,null,{},t),plan=indexMemoryPlan(parameters);
  const payload={parameters,plan,contract:h.contract,previousId:b.previousId};
  return this.rpc('preview',b.contractId,b.requestId,{...payload,hash:indexMemoryHash(payload)},t);
 }
 async internalSource(b:any,t:TenantContext){
  if(!b||Object.keys(b).sort().join(',')!=='contractId,documentId,month'||!uuid(b.contractId)||!uuid(b.documentId)||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(b.month))throw new BadRequestException('Fonte contratual inválida.');
  const h=await this.rpc('history',b.contractId,null,{},t),c=h.contract,db=this.db.getClient();
  await this.licenses.requireEntitlement(t.organizationId,'document_management');
  const r=await db.from('documents').select('*').eq('id',b.documentId).eq('organization_id',t.organizationId).eq('customer_id',c.customer_id).eq('consumer_unit_id',c.consumer_unit_id).eq('energy_contract_id',c.id).maybeSingle(),d=r.data;
  if(r.error||!d||!d.file_verified||d.storage_bucket!=='energy-documents-private'||!d.file_path?.startsWith(t.organizationId+'/'+c.consumer_unit_id+'/')||d.file_path.split('/').some((s:string)=>!s||s==='.'||s==='..')||!/^[a-f0-9]{64}$/.test(d.file_hash)||!Number.isSafeInteger(d.file_size_bytes)||d.file_size_bytes<20||d.file_size_bytes>15*1024*1024)throw new ForbiddenException('Documento contratual verificado e vinculado necessário.');
  const f=await db.storage.from(d.storage_bucket).download(d.file_path);if(f.error||!f.data)throw new ServiceUnavailableException('Fonte interna indisponível.');
  const bytes=Buffer.from(await f.data.arrayBuffer());if(bytes.length!==d.file_size_bytes||bytes.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(bytes).digest('hex')!==d.file_hash)throw new ConflictException('Arquivo ou hash divergente.');
  const extracted=await extractPdfText(bytes),annex=contractAnnexEvidence(extracted.sections,b.month);
  const sections=extracted.sections.filter(s=>annex.sources.some(source=>source.page===s.page&&source.sectionHash===s.hash));
  const normalized=sections.length===1?sections[0].text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase():'';
  const terms=[...normalized.matchAll(/REAJUSTE\s+DATA\s+BASE\s+1[Oº°]?\s*REAJUSTE\s+PERIODICIDADE\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2})\s+MESES/g)];
  const iso=(s:string)=>s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2);
  return {document:{id:d.id,filename:d.original_filename,fileHash:d.file_hash},annex,adjustment:terms.length===1&&annex.state==='PROPOSED'&&annex.index==='IPCA/IBGE'?{baseDate:iso(terms[0][1]),firstAdjustment:iso(terms[0][2]),frequencyMonths:Number(terms[0][3]),index:'IPCA'}:null,excerpt:sections[0]?.text??null,requiresReview:true,externalRequests:0,documentCharge:0};
 }
 async action(b:any,t:TenantContext,action:'authorize'|'cancel'){
  const keys=action==='cancel'?'contractId,id':'acknowledge,contractId,hash,id,note';
  if(!b||Object.keys(b).sort().join(',')!==keys||!uuid(b.contractId)||!uuid(b.id)||(action==='authorize'&&(b.acknowledge!==true||typeof b.hash!=='string'||!/^[a-f0-9]{64}$/.test(b.hash)||typeof b.note!=='string'||b.note.trim().length<20||b.note.length>1000)))throw new BadRequestException('Confirme a fonte e o período desta consulta.');
  if(action==='cancel')return this.rpc('cancel',b.contractId,b.id,{},t);
  // The single-use consent is persisted and claimed before any network I/O.
  const claimed=await this.rpc('claim',b.contractId,b.id,{hash:b.hash,acknowledge:true,note:b.note.trim()},t);
  if(!claimed.acquired)return {...claimed,replayed:true};
  const row=claimed.row;let result:any,state='COMPLETE';
  try{
   const parameters=indexMemoryParameters(row.parameters),plan=indexMemoryPlan(parameters);
   if(indexMemoryHash(plan)!==indexMemoryHash(row.plan))throw Error('Plano alterado.');
   let indices:Record<string,string>={},evidence:any=null;
   if(plan.due){const response=await this.official(plan);indices=parseOfficialIpca(response.data,plan);evidence={url:plan.url,retrievedAt:response.at,sha256:indexMemoryHash(response.data),data:response.data};}
   result={calculation:calculateIndexMemory(parameters,indices,row.contract_snapshot.current_price),evidence,contractSnapshotHash:indexMemoryHash(row.contract_snapshot),sourceDocument:row.source_document,financialApplication:false};
  }catch{state='FAILED';result={message:'Eu, EVA, não consegui confirmar os índices desta consulta. Nenhum preço foi aplicado. Prepare nova memória e autorização para tentar novamente.',automaticRetry:false,financialApplication:false};}
  return this.rpc('finish',b.contractId,b.id,{state,result},t);
 }
 private async official(plan:ReturnType<typeof indexMemoryPlan>){
  const canonical='https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/'+plan.periods.map(m=>m.replace('-','')).join(',')+'?formato=json';
  if(!plan.due||plan.url!==canonical||plan.periods.length<1||plan.periods.length>2||plan.periods.some(m=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)))throw Error('Fonte inválida.');
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
  try{
   const response=await fetch(canonical,{method:'GET',redirect:'error',signal:abort.signal,headers:{Accept:'application/json'}});
   if(!response.ok||!response.body||Number(response.headers.get('content-length')||0)>131072)throw Error('Fonte indisponível.');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
   try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>131072)throw Error('Resposta extensa.');chunks.push(part.value);}}finally{await reader.cancel();}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));return {data,at:new Date().toISOString()};
  }finally{clearTimeout(timer);}
 }
}
