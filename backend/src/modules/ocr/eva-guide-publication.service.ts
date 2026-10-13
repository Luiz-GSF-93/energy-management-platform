import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {PRODUCT_GUIDE_DRAFTS} from './eva-product-guides';
import {ProductGuide,productGuideDocumentHash,productGuideContentHash} from './eva-product-guide-reader';
export const EVA_GUIDE_OWNER='82e7fc71-479a-4dd6-8b22-4fba6eaa6841';
const stable=(v:any):string=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o:any,k)=>(o[k]=x[k],o),{}):x);
const UUID=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function hydrateGuidePublication(g:ProductGuide,r:any):ProductGuide|null{
 if(!r||r.state!=='PUBLISHED'||!UUID.test(r.id??'')||!UUID.test(r.actor_id??'')||r.guide_key!==g.key||r.version!==g.revision.version||r.release!==g.revision.productRelease||r.document_hash!==g.revision.hash||r.content_hash!==g.revision.contentHash||!r.snapshot)return null;
 try{
  const seed={key:g.key,content:g.content,roles:g.roles,permissions:g.permissions,modules:g.modules,codeSnapshots:g.codeSnapshots};
  if(stable(seed)!==stable(r.snapshot)||productGuideContentHash(g.content)!==g.revision.contentHash||productGuideDocumentHash(g,g.revision.version,g.revision.productRelease!,g.revision.validFrom,g.revision.validTo)!==g.revision.hash)return null;
 }catch{return null;}
 return {...g,review:{reference:r.id,documentHash:r.document_hash,contentHash:r.content_hash},revision:{...g.revision,state:'PUBLISHED',reviewedBy:r.actor_id,reviewedAt:r.created_at,publishedAt:r.created_at}};
}
@Injectable()
export class EvaGuidePublicationService {
 constructor(private db:SupabaseService,private config:ConfigService){}
 private enabled(){return this.config.get('EVA_GUIDE_PUBLICATIONS_ENABLED')==='true';}
 private async rpc(name:string,args:Record<string,unknown>){
  let res:any;try{res=await this.db.getClient().rpc(name,args);}catch{throw new ServiceUnavailableException('Biblioteca de guias indisponível.');}
  if(res.error){if(res.error.code==='42501')throw new ForbiddenException('Gestão exclusiva do Owner ativo.');if(res.error.code==='23505')throw new ConflictException('Estado alterado. Atualize a versão antes de continuar.');if(['22023','22P02','23514'].includes(res.error.code))throw new BadRequestException('Dados da publicação inválidos.');throw new ServiceUnavailableException('Biblioteca de guias indisponível.');}return res.data;
 }
 private async action(actor:string,action:string,body:unknown){if(!this.enabled())throw new ServiceUnavailableException('Gestão dos guias desligada; aguardando homologação.');return this.rpc('eva_product_guide_admin_action',{p_actor:actor,p_action:action,p_body:body});}
 async list(actor:string,q:Record<string,unknown>={}){
  if(Object.keys(q).some(k=>!['page','state','search'].includes(k))||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||!['','DRAFT','PUBLISHED','QUARANTINED','STALE'].includes(String(q.state??''))||String(q.search??'').length>100)throw new BadRequestException('Filtros inválidos.');
  const records=await this.action(actor,'list',{});if(!Array.isArray(records))throw new ServiceUnavailableException('Biblioteca de guias indisponível.');
  const rows=PRODUCT_GUIDE_DRAFTS.map(g=>{
   const r=records.find(r=>r.guide_key===g.key&&r.version===g.revision.version);
   const state=!r?'DRAFT':r.state==='QUARANTINED'?'QUARANTINED':hydrateGuidePublication(g,r)?'PUBLISHED':'STALE';
   return {key:g.key,title:g.content.title,version:g.revision.version,release:g.revision.productRelease,state,eventId:r?.event_id??null,publicationId:r?.id??null};
  }).filter(g=>(!q.state||g.state===q.state)&&(!q.search||(g.title+' '+g.key).toLocaleLowerCase('pt-BR').includes(String(q.search).toLocaleLowerCase('pt-BR'))));
  const page=Number(q.page??0);return {page,total:rows.length,pageSize:5,rows:rows.slice(page*5,page*5+5)};
 }
 async detail(actor:string,key:string,q:Record<string,unknown>={}){
  const g=PRODUCT_GUIDE_DRAFTS.find(g=>g.key===key);if(!g||Object.keys(q).some(k=>k!=='page')||q.page!==undefined&&(typeof q.page!=='string'||!/^\d{1,4}$/.test(q.page)||Number(q.page)>1000))throw new BadRequestException('Guia ou página inválidos.');
  const data=await this.action(actor,'detail',{key,version:g.revision.version,page:Number(q.page??0)});
  return {...data,guide:g,currentState:!data.publication?'DRAFT':data.publication.state==='QUARANTINED'?'QUARANTINED':hydrateGuidePublication(g,data.publication)?'PUBLISHED':'STALE'};
 }
 async command(actor:string,key:string,action:'publish'|'quarantine',body:unknown){
  const g=PRODUCT_GUIDE_DRAFTS.find(g=>g.key===key);const b=body as Record<string,unknown>;
  if(!g||!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==4||Object.keys(b).some(k=>!['requestId','expectedEventId','expectedDocumentHash','justification'].includes(k))||typeof b.requestId!=='string'||!UUID.test(b.requestId)||b.expectedEventId!==null&&(typeof b.expectedEventId!=='string'||!UUID.test(b.expectedEventId))||b.expectedDocumentHash!==g.revision.hash||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>1000||/[\x00-\x1f\x7f]/.test(b.justification))throw new BadRequestException('Informe versão conferida e justificativa válidas.');
  const snapshot={key:g.key,content:g.content,roles:g.roles,permissions:g.permissions,modules:g.modules,codeSnapshots:g.codeSnapshots};
  return this.action(actor,action,{...b,key,version:g.revision.version,release:g.revision.productRelease,documentHash:g.revision.hash,contentHash:g.revision.contentHash,...(action==='publish'?{snapshot}:{})});
 }
 async resolve(g:ProductGuide):Promise<ProductGuide|null>{
  if(!this.enabled())return null;
  const row=await this.rpc('eva_product_guide_read_publication',{p_key:g.key,p_version:g.revision.version,p_hash:g.revision.hash});
  return hydrateGuidePublication(g,row);
 }
}
