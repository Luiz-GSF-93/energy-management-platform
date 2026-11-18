import {BadRequestException,ConflictException,ForbiddenException,Injectable,Logger,ServiceUnavailableException} from '@nestjs/common';


import {SupabaseService} from '../../services/supabase.service';


import {LicensesService} from '../licenses/services/licenses.service';


import {TradingHubService} from './trading-hub.service';


import {TenantContext} from '../../common/interfaces/tenant-context.interface';


import {object,text,uuid,validateTrading} from './trading-validation';


import {digest,randomToken,otp,otpDigest,sendTradingMail,tradingMailConfigured,tradingMailFailure,tradingEmailHint} from './trading-mail';
import {tradingEmailHtml} from './trading-email-template';
import {assertQuotationReady,quotationExpired} from './trading-terms';


@Injectable()


export class TradingPortalService {


 constructor(private db:SupabaseService,private hub:TradingHubService,private licenses:LicensesService){}


 private client(){return this.db.getClient();}


 private check(e:any){if(e)throw new ServiceUnavailableException('Operação do portal não confirmada. Consulte o histórico.');}


 private token(v:string){if(!/^[a-f0-9]{64}$/.test(v??''))throw new ForbiddenException('Convite ou sessão inválida.');return v;}


 private async audit(i:any,action:string,details:any){const r=await this.client().from('trading_portal_audit').insert({organization_id:i.organization_id,invitation_id:i.id,action,identity:i.email,details});this.check(r.error);}


 private async invite(hash:string,session=false){const r=session?await this.client().from('trading_invitations').select('*').eq('session_hash',hash).maybeSingle():await this.client().rpc('trading_invitation_for_token',{p_hash:hash});this.check(r.error);const i=r.data;if(!i||!(i.state==='PENDING'||i.kind==='SUPPLIER'&&['RESPONDED','DECLINED'].includes(i.state))||!Number.isFinite(Date.parse(i.expires_at))||Date.parse(i.expires_at)<=Date.now()||(session&&(!Number.isFinite(Date.parse(i.session_expires_at))||Date.parse(i.session_expires_at)<=Date.now())))throw new ForbiddenException('Convite ou sessão inválida, expirada ou revogada. Reabra o link recebido para confirmar seu e-mail enquanto a cotação estiver vigente.');await this.licenses.requireEntitlement(i.organization_id,'trading_hub');const o=await this.client().from('trading_records').select('kind,status,data').eq('organization_id',i.organization_id).eq('id',i.opportunity_id).maybeSingle();this.check(o.error);if(!o.data||o.data.kind!=='opportunity'||!['OPEN','ANALYSIS'].includes(o.data.status)||quotationExpired(o.data.data))throw new ForbiddenException('Cotação expirada ou encerrada. Solicite uma nova rodada.');return {...i,opportunityTitle:o.data.data?.title??null};}


 async hubContract(id:string,b:unknown,t:TenantContext){return this.hub.contract(id,b,t);}
 async invitations(t:TenantContext){await this.hub.allowed(t);const r=await this.client().from('trading_invitations').select('id,opportunity_id,supplier_id,proposal_id,kind,email,state,email_status,email_revision,email_attempt_at,email_http_status,email_error_code,expires_at,created_at').eq('organization_id',t.organizationId).order('created_at',{ascending:false}).limit(1001);this.check(r.error);if(r.data.length>1000)throw new BadRequestException('Consulta extensa; restrinja o período.');return r.data;}


 async revoke(id:string,t:TenantContext){await this.hub.allowed(t,true);uuid(id);const r=await this.client().rpc('revoke_trading_invitation',{p_org:t.organizationId,p_actor:t.userId,p_id:id});this.check(r.error);return {revoked:!!r.data};}


 private async issue(t:TenantContext,o:any,email:string,kind:string,supplierId:string|null,proposalId:string|null){


  const token=randomToken();const r=await this.client().from('trading_invitations').insert({organization_id:t.organizationId,opportunity_id:o.id,supplier_id:supplierId,proposal_id:proposalId,kind,email,token_hash:digest(token),expires_at:o.data.expiresAt,created_by:t.userId}).select('*').single();


  if(r.error?.code==='23505')return {email,state:'EXISTING_INVITATION'};this.check(r.error);const i=r.data;


  return this.deliver(t,o,i,token,0);
 }
 private async deliver(t:TenantContext,o:any,i:any,token:string,revision:number,requestId?:string){
  const email=i.email,kind=i.kind;
  let result:{state:string;messageId?:string;httpStatus:number|null;code:string|null};
  try{const messageId=await sendTradingMail(email,kind==='CLIENT'?'EnergyOS — proposta disponível para sua decisão':'EnergyOS — nova solicitação de cotação ACL',`Existe uma ${kind==='CLIENT'?'proposta aprovada internamente':'cotação'} no Trading Hub da Expert Energy.\n\nAcesse https://app.expertenergy.com.br/cotacao#${token}\n\nO acesso exige código enviado a este mesmo e-mail e expira em ${new Date(o.data.expiresAt).toISOString()}.\nIdentificador: ${o.id}\n\nNão compartilhe o convite.`, 'trading-invite-'+i.id+(requestId?'-'+requestId:''),tradingEmailHtml({title:kind==='CLIENT'?'Sua proposta está pronta para análise':'Convite para cotação de energia',intro:kind==='CLIENT'?'A equipe Expert Energy analisou uma proposta para sua unidade. Acesse o portal para consultar as condições e registrar sua decisão comercial.':'A Expert Energy convida sua empresa a apresentar uma proposta de fornecimento de energia para a oportunidade abaixo. Envie sua cotação e os documentos pelo portal seguro.',actionLabel:kind==='CLIENT'?'Analisar proposta':'Enviar cotação',actionUrl:'https://app.expertenergy.com.br/cotacao#'+token,facts:[['Oportunidade',o.data.title],['Submercado',({SE_CO:'Sudeste / Centro-Oeste',S:'Sul',NE:'Nordeste',N:'Norte'} as Record<string,string>)[o.data.submarket]??o.data.submarket],['Modalidade',({CONVENTIONAL:'Convencional',INCENTIVIZED_50:'Incentivada 50%',INCENTIVIZED_100:'Incentivada 100%'} as Record<string,string>)[o.data.energyType]??o.data.energyType],['Consumo médio',Number(o.data.averageMwhMonth).toLocaleString('pt-BR')+' MWh/mês'],['Fornecimento',o.data.startMonth+' · '+o.data.months+' meses'],['Prazo para resposta',new Date(o.data.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)']],footer:'O acesso exige um código enviado a este mesmo e-mail. O convite é individual e expira no prazo informado. A decisão comercial não substitui a formalização do contrato.'}));result={state:'ACCEPTED',messageId,httpStatus:200,code:null};}
  catch(error){const f=tradingMailFailure(error);result={state:f.state,httpStatus:f.httpStatus,code:f.code};}
  if(requestId){
   const saved=await this.client().rpc('resend_trading_invitation',{p_org:t.organizationId,p_actor:t.userId,p_id:i.id,p_request:requestId,p_expected:revision,p_action:'finish',p_token:null,p_reason:null,p_result:result});this.check(saved.error);
   if(!saved.data?.recorded)throw new ConflictException('O convite mudou durante o envio. Atualize o histórico; não repita automaticamente.');
  }else{
   const saved=await this.client().from('trading_invitations').update({email_status:result.state,email_message_id:result.messageId??null,email_http_status:result.httpStatus,email_error_code:result.code,email_attempt_at:new Date().toISOString()}).eq('organization_id',t.organizationId).eq('id',i.id).eq('email_revision',revision).eq('state','PENDING').select('id');this.check(saved.error);
   if(saved.data?.length!==1)throw new ConflictException('O convite mudou durante o envio. Confira o histórico antes de repetir.');
   await this.audit(i,result.state==='ACCEPTED'?'EMAIL_ACCEPTED':result.state==='REJECTED'?'EMAIL_REJECTED':'EMAIL_UNCONFIRMED',{messageId:result.messageId??null,httpStatus:result.httpStatus,code:result.code,revision});
  }
  return {email,state:result.state,httpStatus:result.httpStatus,code:result.code};
 }
 async resend(id:string,input:unknown,t:TenantContext){
  await this.hub.allowed(t,true);uuid(id);if(process.env.TRADING_QUOTATION_TERMS_REQUIRED==='true'){const invite=await this.client().from('trading_invitations').select('opportunity_id').eq('organization_id',t.organizationId).eq('id',id).maybeSingle();this.check(invite.error);if(!invite.data)throw new ForbiddenException('Convite fora da organização.');const quote=await this.hub.one(invite.data.opportunity_id,t);assertQuotationReady(quote.data);}const b=object(input);
  if(Object.keys(b).sort().join(',')!=='reason,requestId,revision'||!Number.isInteger(b.revision)||b.revision<0)throw new BadRequestException('Confira a revisão, o motivo e o identificador do reenvio.');
  uuid(b.requestId);const reason=text(b.reason,3,500);
  if(!tradingMailConfigured())throw new ServiceUnavailableException('Configure TRADING_RESEND_API_KEY e o remetente exclusivo antes de reenviar.');
  const token=randomToken();const r=await this.client().rpc('resend_trading_invitation',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_request:b.requestId,p_expected:b.revision,p_action:'reserve',p_token:digest(token),p_reason:reason,p_result:null});
  if(r.error?.code==='40001'||r.error?.code==='23505')throw new ConflictException('O convite mudou ou já está em reenvio. Atualize o acompanhamento.');
  if(r.error?.code==='42501')throw new ForbiddenException('Convite fora do escopo, encerrado ou sem autorização.');
  if(r.error?.code==='22023')throw new BadRequestException('Reenvio indisponível: confira prazo, contato e intervalo de 60 segundos.');
  this.check(r.error);const data=r.data;
  if(!data?.claimed)return {email:data?.email,state:data?.state??'UNKNOWN',replayed:true};
  return this.deliver(t,{id:data.opportunityId,data:data.opportunity},{id,organization_id:t.organizationId,email:data.email,kind:data.kind},token,data.revision,b.requestId);
 }

 async dispatch(id:string,input:unknown,t:TenantContext){await this.hub.allowed(t,true);if(!tradingMailConfigured())throw new ServiceUnavailableException('Configure o remetente verificado de cotações no Resend antes de solicitar.');const b=object(input);if(Object.keys(b).some(k=>!['supplierIds','revision'].includes(k))||!Array.isArray(b.supplierIds)||!b.supplierIds.length||b.supplierIds.length>20)throw new BadRequestException('Selecione até 20 fornecedores.');const o=await this.hub.one(id,t);if(o.kind!=='opportunity'||!['DRAFT','OPEN'].includes(o.status)||Date.parse(o.data.expiresAt)<=Date.now()||o.revision!==b.revision)throw new BadRequestException('Cotação mudou ou expirou.');if(process.env.TRADING_QUOTATION_TERMS_REQUIRED==='true'||o.data.commercialTermsVersion===2)assertQuotationReady(o.data);const recipients:{supplierId:string;email:string}[]=[];for(const sId of [...new Set<string>(b.supplierIds)]){const s=await this.hub.one(uuid(sId),t);if(s.kind!=='supplier'||s.status!=='ACTIVE')throw new BadRequestException('Fornecedor precisa estar ativo.');for(const c of s.data.quotationContacts)recipients.push({supplierId:s.id,email:c.email});}if(recipients.length>50)throw new BadRequestException('Até 50 destinatários por solicitação.');if(o.status==='DRAFT')await this.hub.transition(o.id,{status:'OPEN',revision:o.revision,reason:'Solicitação de cotação enviada aos fornecedores selecionados'},t);const results=[];for(const r of recipients)results.push(await this.issue(t,o,r.email,'SUPPLIER',r.supplierId,null));return {results};}


 async inviteClient(id:string,t:TenantContext){await this.hub.allowed(t,true);await this.hub.legacyWorkflowGuard(id,t);if(!tradingMailConfigured())throw new ServiceUnavailableException('Configure o remetente de cotações no Resend.');if(!(['gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation'))throw new ForbiddenException('Gestor ou administrador requerido.');const p=await this.hub.one(id,t);if(p.kind!=='proposal'||p.status!=='MANAGER_APPROVED')throw new BadRequestException('Proposta precisa da aprovação interna.');const o=await this.hub.one(p.parent_id,t);const c=await this.client().from('customers').select('contact_email').eq('organization_id',t.organizationId).eq('id',o.data.customerId).is('deleted_at',null).maybeSingle();this.check(c.error);const email=c.data?.contact_email;if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new BadRequestException('Cadastre o e-mail de contato autorizado do cliente.');return this.issue(t,o,email.toLowerCase(),'CLIENT',null,p.id);}


 private async recordOtpDelivery(i:any,result:{state:string;messageId?:string;httpStatus:number|null;code:string|null}){
  try{await this.audit(i,'OTP_EMAIL_'+result.state,result);}
  catch{new Logger(TradingPortalService.name).warn(JSON.stringify({event:'TRADING_OTP_DELIVERY_AUDIT_UNCONFIRMED',invitationId:i.id,state:result.state,code:result.code}));}
 }
 async challenge(token:string){
  const i=await this.invite(digest(this.token(token)));
  if(!tradingMailConfigured())throw new ServiceUnavailableException('Envio do código temporariamente indisponível. O backoffice deve conferir o remetente de cotações.');
  const challengedAt=Date.now(),title=String(i.opportunityTitle??'').replace(/\s+/g,' ').slice(0,120),code=otp(),r=await this.client().rpc('trading_otp_challenge',{p_hash:digest(token),p_otp:otpDigest(token,code)});this.check(r.error);
  if(!r.data)throw new BadRequestException('Aguarde 60 segundos entre pedidos de código. Há um limite de 10 pedidos por convite por dia. Se o prazo da cotação terminou ou o link foi revogado, solicite orientação ao backoffice.');
  let messageId:string;
  try{messageId=await sendTradingMail(i.email,'EnergyOS — código de acesso'+(title?' · '+title:''),`Cotação: ${title||'Trading Hub'}.\nSeu código de acesso ao Trading Hub é ${code}. Válido por até 10 minutos ou até o prazo do convite. O código é enviado somente ao e-mail que recebeu o convite; não é enviado automaticamente ao abrir o link. Não compartilhe.`, 'trading-otp-'+i.id+'-'+Date.now(),tradingEmailHtml({title:'Confirme seu acesso',intro:'Use o código abaixo no mesmo convite em que você solicitou o acesso ao Trading Hub.',code,...(title?{facts:[['Cotação',title]] as [string,string][]}:{}),footer:'Válido por até 10 minutos ou até a expiração do convite. Use somente o código mais recente solicitado neste link. Não compartilhe. Se não encontrar a mensagem, confira spam e quarentena do e-mail corporativo.'}));}
  catch(error){const failure=tradingMailFailure(error);await this.recordOtpDelivery(i,failure);throw error;}
  await this.recordOtpDelivery(i,{state:'ACCEPTED',messageId,httpStatus:200,code:null});
  return {sent:true,emailHint:tradingEmailHint(i.email),resendAfterSeconds:60,expiresAt:new Date(Math.min(challengedAt+600000,Date.parse(i.expires_at))).toISOString()};
 }


 async verify(token:string,input:unknown){this.token(token);const b=object(input);if(Object.keys(b).some(k=>k!=='code')||!/^\d{6}$/.test(b.code))throw new BadRequestException('Informe o código de seis dígitos.');const session=randomToken();const r=await this.client().rpc('trading_otp_verify',{p_hash:digest(token),p_otp:otpDigest(token,b.code),p_session:digest(session)});this.check(r.error);if(!r.data)throw new ForbiddenException('Código inválido, expirado ou excedeu tentativas.');return {session};}


 async view(session:string){const i=await this.invite(digest(this.token(session)),true);const o=await this.client().from('trading_records').select('id,data,status').eq('organization_id',i.organization_id).eq('id',i.opportunity_id).single();this.check(o.error);if(!['OPEN','ANALYSIS'].includes(o.data.status))throw new ForbiddenException('Cotação encerrada.');const c=await this.client().from('customers').select('company_name').eq('organization_id',i.organization_id).eq('id',o.data.data.customerId).maybeSingle();this.check(c.error);


  let proposal=null;if(i.kind==='CLIENT'){const p=await this.client().from('trading_records').select('id,data,status').eq('organization_id',i.organization_id).eq('id',i.proposal_id).eq('status','MANAGER_APPROVED').single();this.check(p.error);proposal={id:p.data.id,...p.data.data};}


  const d=o.data.data;const pending=await this.client().from('trading_invitations').select('opportunity_id,state,expires_at').eq('organization_id',i.organization_id).eq('email',i.email).eq('kind',i.kind).in('state',['PENDING','RESPONDED']);this.check(pending.error);


  return {kind:i.kind,email:i.email,supplierId:i.supplier_id,invitationState:i.state,canRespond:i.state==='PENDING',expiresAt:new Date(Math.min(Date.parse(i.expires_at),Date.parse(d.expiresAt))).toISOString(),opportunity:{id:o.data.id,title:d.title,customer:c.data?.company_name??'Cliente',distributor:d.distributor,submarket:d.submarket,averageMwhMonth:d.averageMwhMonth,energyType:d.energyType,months:d.months,startMonth:d.startMonth,annualReferencePrices:d.annualReferencePrices??[],flexibilityUpperPercent:d.flexibilityUpperPercent,flexibilityLowerPercent:d.flexibilityLowerPercent,seasonality:d.seasonality,correctionIndex:d.correctionIndex,billingTerms:d.billingTerms,documents:d.documents??[]},proposal,dashboard:{pending:pending.data.filter((x:any)=>x.state==='PENDING'&&Date.parse(x.expires_at)>Date.now()).length,responded:pending.data.filter((x:any)=>x.state==='RESPONDED').length}};


 }


 async reply(session:string,input:unknown){const i=await this.invite(digest(this.token(session)),true);if(i.state!=='PENDING')throw new ConflictException('Sua resposta já foi registrada. Consulte a cotação e use a conversa para tratar ajustes com o backoffice.');const b=object(input);if(Object.keys(b).some(k=>!['action','data','reason'].includes(k)))throw new BadRequestException('Campo inválido.');let data:any={};let reason='Resposta comercial pelo portal';if(i.kind==='SUPPLIER'&&b.action==='RESPOND'){data=validateTrading('proposal',{...object(b.data),supplierId:i.supplier_id});for(const id of data.documents){const f=await this.client().from('trading_files').select('id').eq('organization_id',i.organization_id).eq('invitation_id',i.id).eq('id',id).maybeSingle();this.check(f.error);if(!f.data)throw new ForbiddenException('Anexo fora do convite.');}}else if(b.action==='DECLINE'&&i.kind==='SUPPLIER'){data={declineReason:text(object(b.data).declineReason,1,40)};reason=text(b.reason,3,500);}else if(b.action==='APPROVE'&&i.kind==='CLIENT'){if(b.data?.confirmed!==true)throw new BadRequestException('Confirme a leitura da proposta.');reason=text(b.reason,3,500);}else throw new BadRequestException('Ação inválida.');const r=await this.client().rpc('trading_portal_reply',{p_session:digest(session),p_data:data,p_action:b.action,p_reason:reason});this.check(r.error);return r.data;}


 async upload(session:string,file:any){const i=await this.invite(digest(this.token(session)),true);if(i.state!=='PENDING'||i.kind!=='SUPPLIER'||!file?.buffer||file.buffer.length>10485760||file.buffer.length<8||!file.buffer.subarray(0,5).equals(Buffer.from('%PDF-')))throw new BadRequestException('Anexe PDF de até 10 MB.');const count=await this.client().from('trading_files').select('id',{count:'exact',head:true}).eq('invitation_id',i.id);this.check(count.error);if(count.count>=10)throw new BadRequestException('Até 10 arquivos por convite.');const key=randomToken(),path=i.organization_id+'/'+i.id+'/'+key+'.pdf';const upload=await this.client().storage.from('trading-private').upload(path,file.buffer,{contentType:'application/pdf',upsert:false});this.check(upload.error);const row=await this.client().from('trading_files').insert({organization_id:i.organization_id,invitation_id:i.id,path,filename:String(file.originalname??'proposta.pdf').replace(/[^\p{L}\p{N}_. -]/gu,'_').slice(0,200),sha256:digest(file.buffer),size_bytes:file.buffer.length}).select('id,filename').single();this.check(row.error);return row.data;}


 async backofficeFile(id:string,t:TenantContext){await this.hub.allowed(t);uuid(id);const r=await this.client().from('trading_files').select('path,filename').eq('organization_id',t.organizationId).eq('id',id).maybeSingle();this.check(r.error);if(r.data){if(!r.data.path.startsWith(t.organizationId+'/'))throw new ForbiddenException('Arquivo fora do escopo.');const u=await this.client().storage.from('trading-private').createSignedUrl(r.data.path,60,{download:r.data.filename});this.check(u.error);return {url:u.data.signedUrl};}const d=await this.client().from('documents').select('file_path,storage_bucket,original_filename,file_verified').eq('organization_id',t.organizationId).eq('id',id).maybeSingle();this.check(d.error);if(!d.data?.file_verified||d.data.storage_bucket!=='energy-documents-private'||!d.data.file_path.startsWith(t.organizationId+'/'))throw new ForbiddenException('Arquivo indisponível.');const u=await this.client().storage.from(d.data.storage_bucket).createSignedUrl(d.data.file_path,60,{download:d.data.original_filename});this.check(u.error);return {url:u.data.signedUrl};}


 async download(session:string,id:string){const i=await this.invite(digest(this.token(session)),true);const o=await this.client().from('trading_records').select('data').eq('organization_id',i.organization_id).eq('id',i.opportunity_id).single();this.check(o.error);const ttl=Math.max(1,Math.min(60,Math.floor((Math.min(Date.parse(i.expires_at),Date.parse(o.data.data.expiresAt))-Date.now())/1000)));let allowed=o.data.data.documents??[];if(i.kind==='CLIENT'){const p=await this.client().from('trading_records').select('data').eq('organization_id',i.organization_id).eq('id',i.proposal_id).eq('status','MANAGER_APPROVED').single();this.check(p.error);allowed=[...allowed,...(p.data.data.documents??[])];}if(!allowed.includes(id))throw new ForbiddenException('Documento não incluído no convite.');const f=await this.client().from('trading_files').select('path,filename').eq('organization_id',i.organization_id).eq('id',id).maybeSingle();this.check(f.error);if(f.data){if(!f.data.path.startsWith(i.organization_id+'/'))throw new ForbiddenException('Arquivo fora do convite.');const u=await this.client().storage.from('trading-private').createSignedUrl(f.data.path,ttl,{download:f.data.filename});this.check(u.error);return {url:u.data.signedUrl};}const d=await this.client().from('documents').select('storage_bucket,file_path,original_filename,file_verified').eq('organization_id',i.organization_id).eq('id',id).maybeSingle();this.check(d.error);if(!d.data?.file_verified||d.data.storage_bucket!=='energy-documents-private'||!d.data.file_path.startsWith(i.organization_id+'/'))throw new ForbiddenException('Documento indisponível.');const r=await this.client().storage.from(d.data.storage_bucket).createSignedUrl(d.data.file_path,ttl,{download:d.data.original_filename});this.check(r.error);return {url:r.data.signedUrl};}


}


