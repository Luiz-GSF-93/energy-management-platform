import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException,StreamableFile} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {DocumentFile,DOCUMENT_BUCKET,inspectDocumentUpload} from '../documents/services/document-file';
import {assertPortalInvoiceUpload} from './portal-invoice-kind';

export const intakeOrganizations=()=>process.env.EVA_AUTOMATIC_INTAKE_ENABLED==='true'?String(process.env.EVA_AUTOMATIC_INTAKE_ORGANIZATIONS??'').split(',').map(s=>s.trim()).filter(Boolean):[];
export const intakePath=(org:string,id:string,mime:string)=>org+'/eva-intake/'+id+(mime==='application/pdf'?'.pdf':mime==='image/png'?'.png':'.jpg');
@Injectable()
export class AutomaticIntakeService{
 constructor(private db:SupabaseService){}
 enabled(org:string){return intakeOrganizations().includes(org);}
 private async action(t:TenantContext,action:string,id:string|null,body:any,administration=false){
  if(!this.enabled(t.organizationId))throw new ServiceUnavailableException('Recebimento automático ainda não habilitado nesta organização.');
  const r=await this.db.getClient().rpc(administration?'eva_intake_administration':'eva_intake_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,p_id:id,p_body:body});
  if(r.error?.code==='42501')throw new ForbiddenException('Vínculo ou permissão de documentos indisponível.');
  if(r.error?.code==='P3391')throw new ConflictException('A cota de documentos está esgotada. O envio não foi iniciado.');
  if(r.error)throw new ConflictException('Recebimento não confirmado. Confira os envios antes de repetir.');
  return r.data;
 }
 async list(t:TenantContext,query:any={}){
  if(Object.keys(query).some(k=>!['customerId','queueOnly'].includes(k))||query.queueOnly!==undefined&&!['true','false'].includes(query.queueOnly))throw new BadRequestException('Consulta inválida.');
  if(!this.enabled(t.organizationId))return {enabled:false,rows:[]};
  const external=t.role==='consulta'&&!t.accessMode;
  const selection=external?{...query,queueOnly:'true'}:query;
  const present=(result:any)=>external?{...result,completed:[]}:result;
  const administer=async(result:any)=>{if(external)return result;const admin=await this.action(t,'list',null,{},true);return {...result,dismissed:admin.dismissed??[],rows:(result.rows??[]).map((r:any)=>(admin.dismissible??[]).includes(r.id)?{...r,status:{...r.status,canDismiss:true}}:r)};};
  const data=present(await this.action(t,'list',null,selection));
  const candidates=[...(data.rows??[]),...(data.completed??[])].filter((r:any)=>r.documentId&&r.documentType==='INVOICE_DISTRIBUTOR'&&r.state==='UNKNOWN');
  const ids=[...new Set<string>(candidates.map((r:any)=>r.id))];if(!ids.length)return administer({enabled:true,...data});
  const proof=await this.db.getClient().rpc('eva_intake_published_completions',{p_org:t.organizationId,p_ids:ids});
  const validId=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
  if(proof.error||!Array.isArray(proof.data)||proof.data.length>ids.length||new Set(proof.data.map((p:any)=>p?.id)).size!==proof.data.length||proof.data.some((p:any)=>!p||!ids.includes(p.id)||!validId(p.closingId)||!validId(p.publicationId)||typeof p.publishedAt!=='string'||!Number.isFinite(Date.parse(p.publishedAt))))throw new ServiceUnavailableException('Não foi possível confirmar o andamento atual. Os documentos e as decisões anteriores foram preservados.');
  const completed=new Map(proof.data.map((p:any)=>[p.id,p]));
  const project=(r:any)=>{const p:any=completed.get(r.id);return p?{...r,processingState:r.state,state:'PUBLISHED',percent:100,updatedAt:p.publishedAt,status:{...r.status,percent:100,prepared:true},note:'Concluído pela versão aprovada e publicada. O processamento anterior permanece no histórico.',completion:{closingId:p.closingId,publicationId:p.publicationId}}:r;};
  const archived=[...(data.completed??[]).map(project),...(data.rows??[]).filter((r:any)=>completed.has(r.id)).map(project)];
  return administer(present({enabled:true,...data,revision:createHash('sha256').update(JSON.stringify([data.revision??null,proof.data])).digest('hex'),rows:(data.rows??[]).filter((r:any)=>selection.queueOnly!=='true'||!completed.has(r.id)).map(project),completed:[...new Map(archived.map((r:any)=>[r.id,r])).values()].sort((a:any,b:any)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??''))).slice(0,5)}));
 }
 async retry(t:TenantContext,id:string,body:any){
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)||!body||Object.keys(body).length)throw new BadRequestException('Retomada inválida.');
  return this.action(t,'retry',id,{});
 }
 async dismiss(t:TenantContext,id:string,body:any){
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)||!body||Object.keys(body).sort().join(',')!=='reason'||typeof body.reason!=='string'||body.reason.trim().length<15||body.reason.length>1000)throw new BadRequestException('Informe o motivo do envio incorreto, com 15 a 1000 caracteres.');
  return this.action(t,'dismiss',id,{reason:body.reason.trim()},true);
 }
 async resolve(t:TenantContext,id:string,body:any){
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)||!body||Object.keys(body).sort().join(',')!=='customerId,month,reason,unitId')throw new BadRequestException('Confira somente o vínculo solicitado.');
  return this.action(t,'resolve',id,body);
 }
 async content(t:TenantContext,id:string){
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw new BadRequestException('Envio inválido.');
  const source=await this.action(t,'source',id,{}),path=intakePath(t.organizationId,id,source.mime);
  const result=await this.db.getClient().storage.from(DOCUMENT_BUCKET).download(path);
  if(result.error||!result.data||result.data.size!==source.size)throw new ServiceUnavailableException('Arquivo original indisponível.');
  const bytes=Buffer.from(await result.data.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==source.hash)throw new ConflictException('Integridade do original não confirmada.');
  const fresh=await this.action(t,'source',id,{});if(fresh.hash!==source.hash)throw new ConflictException('Fonte alterada.');
  return new StreamableFile(bytes,{type:source.mime,disposition:'inline',length:bytes.length});
 }
 async upload(t:TenantContext,input:any,file:DocumentFile){
  if(!input||Object.keys(input).some(k=>!['requestId','customerId','unitId','month','consent'].includes(k))||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId??'')||input.month&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month)||!['true','false',true,false].includes(input.consent))throw new BadRequestException('Confira o arquivo e a autorização de leitura.');
  const detected=await inspectDocumentUpload(file,false),hash=createHash('sha256').update(file.buffer).digest('hex');
  if(t.role==='consulta'&&!t.accessMode)await assertPortalInvoiceUpload(file,detected.mime);
  const hints=Object.fromEntries(['unitId','month'].filter(k=>input[k]).map(k=>[k,input[k]]));
  const receipt=await this.action(t,'reserve',randomUUID(),{...(input.customerId?{customerId:input.customerId}:{}),requestId:input.requestId,hash,filename:detected.name,mime:detected.mime,size:file.buffer.length,consent:input.consent===true||input.consent==='true',hints});
  if(!receipt.stored){
   const storage=this.db.getClient().storage.from(DOCUMENT_BUCKET),path=intakePath(t.organizationId,receipt.id,detected.mime);
   const stored=await storage.upload(path,file.buffer,{contentType:detected.mime,upsert:false});
   if(stored.error){
    // A lost acknowledgement may have stored the original. Inspect that exact
    // immutable key; never overwrite it or remove a potentially referenced file.
    const prior=await storage.download(path);
    if(prior.error||!prior.data||prior.data.size!==file.buffer.length||createHash('sha256').update(Buffer.from(await prior.data.arrayBuffer())).digest('hex')!==hash)throw new ServiceUnavailableException('Arquivo em conferência. Atualize os envios antes de repetir.');
   }
   await this.action(t,'stored',receipt.id,{hash});
  }
  return {id:receipt.id,replayed:receipt.replayed,state:receipt.state,message:'Arquivo recebido. A EVA reconhecerá o vínculo, a competência e as fontes disponíveis automaticamente.'};
 }
}
