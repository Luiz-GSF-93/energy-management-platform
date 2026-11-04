import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {randomUUID} from 'crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {TradingHubService} from './trading-hub.service';
import {object,text,uuid} from './trading-validation';
import {digest,otp,otpDigest,randomToken,sendTradingMail,tradingMailConfigured,tradingMailFailure} from './trading-mail';
import {validateOriginalPdf} from '../ocr/eva-original-pdf.validator';
import {validateTradingImage} from './trading-image.validator';
import {portalDeliveryBudget} from '../portal-workspace/portal-notifications.worker';

const LIMIT=20*1024*1024;
export function workflowBody(input:unknown,portal=false){
 const b=object(input);if(Object.keys(b).some(k=>!['action','revision','requestId','reason','data'].includes(k))||!Number.isInteger(b.revision)||b.revision<1)throw new BadRequestException('Confira a revisão da proposta.');
 uuid(b.requestId);text(b.reason,3,500);const data=object(b.data??{});
 const fields:Record<string,string[]>={REGISTER:[],REVIEW_CURRENT:[],REQUEST_INTERNAL:[],APPROVE_INTERNAL:[],REJECT_INTERNAL:[],SEND_CLIENT:['recipientId','hours','confirmed'],CLIENT_APPROVE:['confirmed'],CLIENT_REJECT:['confirmed'],NOTIFY_SUPPLIER:['email','confirmed'],COMPLETE:['documentId','reference','confirmed'],REVOKE:['confirmed']};
 if(!(b.action in fields)||portal!==['CLIENT_APPROVE','CLIENT_REJECT'].includes(b.action)||Object.keys(data).some(k=>!fields[b.action].includes(k)))throw new BadRequestException('Ação ou campos indisponíveis nesta etapa.');
 if(['SEND_CLIENT','CLIENT_APPROVE','CLIENT_REJECT','NOTIFY_SUPPLIER','COMPLETE','REVOKE'].includes(b.action)&&data.confirmed!==true)throw new BadRequestException('Confirme a decisão e os destinatários.');
 if(b.action==='SEND_CLIENT'){uuid(data.recipientId);if(![4,8].includes(data.hours))throw new BadRequestException('Escolha 4 ou 8 horas.');}
 if(b.action==='NOTIFY_SUPPLIER'&&(typeof data.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)||data.email.length>320))throw new BadRequestException('Selecione o contato que respondeu à cotação.');
 if(b.action==='COMPLETE'){text(data.documentId,1,200);text(data.reference,3,200);}
 return {action:String(b.action),revision:Number(b.revision),requestId:String(b.requestId),reason:String(b.reason),data};
}
export function fileBatch(files:any[]){
 if(!Array.isArray(files)||!files.length||files.length>20||files.reduce((n,f)=>n+(f.buffer?.length??LIMIT+1),0)>LIMIT)throw new BadRequestException('Envie até 20 MB somados por lote. Para mais arquivos, envie outro lote.');
 return files.map(f=>{if(!Buffer.isBuffer(f.buffer)||f.buffer.length<8||f.buffer.length>LIMIT)throw new BadRequestException('Arquivo vazio ou acima de 20 MB.');
  const b=f.buffer;let mime='',ext='';
  if(b.subarray(0,5).equals(Buffer.from('%PDF-'))){mime='application/pdf';ext='.pdf';}
  else if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.length>=33&&b.subarray(-8,-4).toString('ascii')==='IEND'){mime='image/png';ext='.png';}
  else if(b[0]===255&&b[1]===216&&b[2]===255&&b[b.length-2]===255&&b[b.length-1]===217){mime='image/jpeg';ext='.jpg';}
  if(!mime)throw new BadRequestException('Conteúdo inválido. Envie PDF, JPEG ou PNG.');
  const filename=String(f.originalname??'arquivo').replace(/[^\p{L}\p{N}_. ()-]/gu,'_').slice(0,170).replace(/\.[^.]*$/,'')+ext;
  return{id:randomUUID(),name:filename,mime,size:b.length,hash:digest(b),buffer:b};
 });
}
@Injectable()
export class TradingWorkflowService{
 constructor(private db:SupabaseService,private hub:TradingHubService){}
 // New RPCs perform their own actor, organization, client and unit checks. Never expose this client to a DTO.
 private client(){return this.db.createAuthClient();}
 async rpc(name:string,args:any){const r=await this.client().rpc(name,args);if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Acesso, licença, destinatário ou etapa indisponível.');if(['40001','23505','P3151'].includes(r.error.code))throw new ConflictException('A proposta ou a solicitação mudou. Atualize o acompanhamento antes de repetir.');if(['22023','23514','22P02'].includes(r.error.code))throw new BadRequestException('Confira a ação, o prazo, o responsável e as evidências desta etapa.');throw new ServiceUnavailableException('Resultado não confirmado. Consulte o acompanhamento antes de repetir.');}return r.data;}
 private async allowed(t:TenantContext,portal=false,write=false){if(t.organizationId!=='org_default')throw new ForbiddenException('Fluxo ainda não habilitado nesta organização.');if(portal){if(t.role!=='consulta'||t.accessMode)throw new ForbiddenException('Acesso exclusivo ao responsável do cliente.');}else await this.hub.allowed(t,write);}
 async read(t:TenantContext,portal=false,page=0,proposal?:string){if(t.organizationId!=='org_default')return{enabled:false,organizationId:t.organizationId,rows:[]};await this.allowed(t,portal);if(!Number.isInteger(page)||page<0||page>1000)throw new BadRequestException('Página inválida.');if(proposal)uuid(proposal);
  const result=await this.rpc('trading_workflow_read',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_portal:portal,p_customer:t.portalCustomerScope?.customerId??null,p_page:page,p_proposal:proposal??null});
  if(!portal)result.communication={enabled:process.env.PORTAL_EXTERNAL_NOTIFICATIONS_ENABLED==='true',budgetConfigured:!!portalDeliveryBudget(),emailConfigured:tradingMailConfigured()};return result;}
 async tasks(t:TenantContext,portal=false){if(t.organizationId!=='org_default')return{organizationId:t.organizationId,count:0};await this.allowed(t,portal);return this.rpc('trading_workflow_tasks',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_portal:portal,p_customer:t.portalCustomerScope?.customerId??null});}
 async act(t:TenantContext,id:string,input:unknown,portal=false){await this.allowed(t,portal,true);uuid(id);const b=workflowBody(input,portal);let token:string|undefined;
  if(b.action==='NOTIFY_SUPPLIER'){if(!tradingMailConfigured())throw new ServiceUnavailableException('Configure o remetente de cotações antes de avisar o fornecedor.');token=randomToken();b.data.tokenHash=digest(token);}
  const value=await this.rpc('trading_workflow_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_portal:portal,p_proposal:id,p_revision:b.revision,p_request:b.requestId,p_action:b.action,p_reason:b.reason,p_body:b.data});
  if(token&&value.replayed)return{...value,delivery:{state:'UNKNOWN',diagnostic:'PREVIOUS_SEND_PRESERVED_INSPECT_RECEIPT'}};
  if(token){let receipt:any;try{const providerId=await sendTradingMail(b.data.email,'EnergyOS — proposta aprovada: continuidade da formalização','A proposta foi aprovada pelo cliente. Confira as condições, confirme o aceite e informe os documentos necessários à formalização.\nhttps://app.expertenergy.com.br/cotacao/formalizacao#'+token+'\nEste acesso é individual, exige verificação por e-mail e será revogado ao encerrar a negociação. A decisão comercial não substitui o contrato.','trading-formalization/'+b.requestId);receipt={state:'ACCEPTED',providerId};}catch(e){const f=tradingMailFailure(e);receipt={state:f.state==='REJECTED'||f.state==='NOT_CONFIGURED'?'FAILED':'UNKNOWN',diagnostic:f.code};}
   await this.rpc('trading_workflow_supplier_receipt',{p_org:t.organizationId,p_actor:t.userId,p_workflow:value.id,p_request:b.requestId,p_result:receipt});return{...value,delivery:receipt};
  }return value;
 }
 private secret(v:string){if(!/^[a-f0-9]{64}$/.test(v??''))throw new ForbiddenException('Acesso inválido.');return v;}
 async challenge(token:string){this.secret(token);if(!tradingMailConfigured())throw new ServiceUnavailableException('Envio de código indisponível.');const code=otp();const r=await this.rpc('trading_formalization_auth',{p_hash:digest(token),p_action:'CHALLENGE',p_otp:otpDigest(token,code),p_session:null});if(!r.allowed)throw new BadRequestException('Aguarde um minuto antes de solicitar outro código.');await sendTradingMail(r.email,'EnergyOS — código para formalização',`Código: ${code}. Válido por 10 minutos. Não compartilhe.`,'formalization-otp/'+r.id+'/'+Date.now());return{sent:true};}
 async verify(token:string,input:unknown){this.secret(token);const b=object(input);if(Object.keys(b).join(',')!=='code'||!/^\d{6}$/.test(b.code??''))throw new BadRequestException('Informe o código de seis dígitos.');const session=randomToken();const r=await this.rpc('trading_formalization_auth',{p_hash:digest(token),p_action:'VERIFY',p_otp:otpDigest(token,b.code),p_session:digest(session)});if(!r.allowed)throw new ForbiddenException('Código inválido, expirado ou limite de tentativas atingido.');return{session};}
 async supplierView(session:string){return this.rpc('trading_formalization_view',{p_hash:digest(this.secret(session))});}
 async supplierAccept(session:string,input:unknown){const b=object(input);if(Object.keys(b).some(k=>!['revision','requestId','confirmed','documents'].includes(k))||!Number.isInteger(b.revision))throw new BadRequestException('Revise a confirmação.');uuid(b.requestId);text(b.documents,10,2000);return this.rpc('trading_formalization_accept',{p_hash:digest(this.secret(session)),p_revision:b.revision,p_request:b.requestId,p_reason:b.documents,p_confirmed:b.confirmed===true});}
 async files(t:TenantContext|null,id:string|null,session:string|null,action:string,batch:string|null,body:any){if(t){await this.allowed(t,false,action!=='DOWNLOAD');if(id)uuid(id);}return this.rpc('trading_workflow_files',{p_org:t?.organizationId??null,p_actor:t?.userId??null,p_workflow:id,p_session:session?digest(this.secret(session)):null,p_action:action,p_batch:batch,p_body:body});}
 async upload(t:TenantContext|null,id:string|null,session:string|null,input:any[],batch:string){uuid(batch);await this.files(t,id,session,'CONTEXT',null,{});const files=fileBatch(input);
  // Parse PDFs in the existing bounded validator before storage; no OCR or interpretation is invoked.
  for(const f of files)if(f.mime==='application/pdf')await validateOriginalPdf({buffer:f.buffer,size:f.size,mimetype:f.mime,originalname:f.name} as any);else await validateTradingImage(f.buffer,f.mime);
  const v=await this.files(t,id,session,'RESERVE',batch,{files:files.map(({buffer,...f})=>f)});const client=this.client();
  for(const f of files){const saved=v.files.find((r:any)=>r.hash===f.hash&&r.name===f.name);if(!saved||saved.path!==v.organizationId+'/trading/'+v.workflowId+'/'+saved.id)throw new ForbiddenException('Arquivo fora da negociação.');if(saved.state==='ARCHIVED')continue;const r=await client.storage.from('energy-documents-private').upload(saved.path,f.buffer,{contentType:f.mime,upsert:false});if(r.error){const prior=await client.storage.from('energy-documents-private').download(saved.path);if(prior.error||!prior.data||digest(Buffer.from(await prior.data.arrayBuffer()))!==f.hash)throw new ServiceUnavailableException('Upload não confirmado. Consulte o lote antes de reenviar; arquivos existentes foram preservados.');}}
  return this.files(t,id,session,'FINISH',batch,{});
 }
 async download(t:TenantContext|null,id:string|null,session:string|null,fileId:string){uuid(fileId);const f=await this.files(t,id,session,'DOWNLOAD',null,{id:fileId});if(!f.path.startsWith(f.organization_id+'/trading/'+f.workflow_id+'/'))throw new ForbiddenException('Arquivo fora da negociação.');const r=await this.client().storage.from('energy-documents-private').download(f.path);if(r.error||!r.data)throw new ServiceUnavailableException('Arquivo indisponível.');const bytes=Buffer.from(await r.data.arrayBuffer());if(bytes.length!==Number(f.size_bytes)||digest(bytes)!==f.sha256)throw new ServiceUnavailableException('Integridade do arquivo não confirmada.');await this.files(t,id,session,'DOWNLOAD',null,{id:fileId});return{bytes,mime:f.mime,name:f.filename};}
}
