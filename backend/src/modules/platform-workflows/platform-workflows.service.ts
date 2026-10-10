import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {createHash,randomUUID} from 'crypto';
import {SupabaseService} from '../../services/supabase.service';
import {DocumentFile,inspectDocument} from '../documents/services/document-file';
export const PREPARE='a7c8f257-580d-4d39-8900-4a5788068201',CONFIRM='a7c8f257-580d-4d39-8900-4a5788068202',CASES='a7c8f257-580d-4d39-8900-4a5788068203',ASSIGNED='a7c8f257-580d-4d39-8900-4a5788068204';
const bucket='platform-financial-evidence';
export type WorkflowActor={userId:string;ip?:string;agent?:string};
@Injectable()
export class PlatformWorkflowsService{
 constructor(private readonly db:SupabaseService){}
 async rpc(name:string,args:Record<string,unknown>){
  let result:any;
  try{result=await this.db.getClient().rpc(name,args);}catch{throw new ServiceUnavailableException('Operação não confirmada. Atualize antes de repetir.');}
  if(result.error?.code==='42501')throw new ForbiddenException('Perfil, atribuição ou confirmação por outro Owner obrigatórios.');
  if(['40001','23505'].includes(result.error?.code))throw new ConflictException('Versão desatualizada ou documento/referência já registrado. Atualize para conferir.');
  if(['22023','22007','22008','22P02','23514','23503'].includes(result.error?.code))throw new BadRequestException('Confira campos, documento, rateio e transição de situação.');
  if(result.error||result.data==null)throw new ServiceUnavailableException('Registro indisponível. Nenhum pagamento ou mensagem foi gerado.');
  return result.data;
 }
 read(actor:WorkflowActor,kind:string,page=0,id?:string,filter:Record<string,string>={}){return this.rpc('read_platform_workflows',{p_actor:actor.userId,p_kind:kind,p_page:page,p_id:id??null,p_filter:filter});}
 async save(actor:WorkflowActor,kind:string,id:string,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Dados inválidos.');
  const dto=input as Record<string,unknown>,keys=kind==='finance'?['revision','action','body']:['revision','body'];
  if(Object.keys(dto).some(k=>!keys.includes(k))||!Number.isInteger(dto.revision)||Number(dto.revision)<0||Number(dto.revision)>1000000||!dto.body||typeof dto.body!=='object'||Array.isArray(dto.body)||JSON.stringify(dto.body).length>250000)throw new BadRequestException('Dados ou revisão inválidos.');
  if(kind==='finance'&&!['PROPOSE','CONFIRM','REJECT'].includes(String(dto.action)))throw new BadRequestException('Ação inválida.');
  return this.rpc(kind==='finance'?'save_platform_reconciliation':'save_platform_support_case',{p_actor:actor.userId,p_id:id,p_revision:dto.revision,p_body:dto.body,...(kind==='finance'?{p_action:dto.action}:{}),p_ip:actor.ip??null,p_agent:actor.agent??null});
 }
 async upload(actor:WorkflowActor,file?:DocumentFile){
  await this.read(actor,'finance'); // Fresh authorization before any object is created.
  const detected=inspectDocument(file);
  if(detected.mime!=='application/pdf'||detected.name.length>200)throw new BadRequestException('Envie o documento financeiro em PDF, até 10 MB.');
  const bytes=file!.buffer,id=randomUUID(),path=id+'/evidence.pdf',sha256=createHash('sha256').update(bytes).digest('hex');
  const existing=await this.rpc('find_platform_financial_evidence',{p_actor:actor.userId,p_hash:sha256});
  if(existing.id)return existing;
  const storage=this.db.getClient().storage.from(bucket);
  let upload:any;try{upload=await storage.upload(path,bytes,{contentType:'application/pdf',upsert:false});}catch{throw new ServiceUnavailableException('Envio não confirmado; confira antes de repetir.');}
  if(upload.error)throw new ServiceUnavailableException('Não foi possível armazenar o documento privado.');
  // On a database/transport ambiguity preserve the object for recovery; never delete possible evidence.
  return this.rpc('register_platform_financial_evidence',{p_actor:actor.userId,p_id:id,p_hash:sha256,p_path:path,p_filename:detected.name,p_bytes:bytes.length});
 }
 async download(actor:WorkflowActor,id:string){
  const row=await this.rpc('platform_financial_evidence_path',{p_actor:actor.userId,p_id:id});
  if(!row.path)throw new NotFoundException('Documento indisponível.');
  let result:any;try{result=await this.db.getClient().storage.from(bucket).createSignedUrl(row.path,60,{download:row.filename});}catch{throw new ServiceUnavailableException('Documento indisponível.');}
  if(result.error||!result.data?.signedUrl)throw new ServiceUnavailableException('Documento indisponível.');
  return {url:result.data.signedUrl,expiresIn:60};
 }
}
