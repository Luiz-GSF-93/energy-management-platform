import{networkAddress}from'./network-address.mjs';
import {randomBytes,randomUUID,createHash}from'node:crypto';
import {readFile}from'node:fs/promises';
import {ProjectError}from'./project-policy.mjs';
import {assessProject}from'./evaluation.mjs';
import {emailAddress}from'./communications-policy.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const fail=(m,s=422)=>{throw new ProjectError(m,s);};
const categories=['manufacturer_manual','other','bills','baseline','diagram','art','budgets','mv_plan','consent','cnpj_status','distributor_clearance','tax_clearance','labor_clearance','fgts'];
const cookie='__Host-pee_client';
export function validatePortalFields(fields,answers){
 if(!Array.isArray(fields)||fields.length>40)fail('Informe até 40 campos para o formulário.');
 const seen=new Set(),clean=fields.map(f=>{
  if(!f||!/^field_[a-z0-9_]{1,50}$/.test(f.id)||seen.has(f.id)||!['text','number','date'].includes(f.type)||typeof f.label!=='string'||!f.label.trim()||f.label.length>300)fail('Confira os campos do formulário.');seen.add(f.id);
  return{id:f.id,type:f.type,label:f.label.trim(),required:f.required===true};
 });
 if(answers===undefined)return clean;
 if(!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).some(k=>!seen.has(k)))fail('Respostas não pertencem ao formulário solicitado.');
 const out={};for(const f of clean){const v=answers[f.id]??'';if(typeof v!=='string'||v.length>10000||f.required&&!v.trim())fail('Preencha '+f.label+'.');if(v&&f.type==='number'&&!/^-?\d+(?:[.,]\d+)?$/.test(v)||v&&f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v))fail('Confira '+f.label+'.');out[f.id]=v.trim();}return out;
}
export function portalFile(input,{tenant,project,category,requirement_id=null}){
 if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>200||input.mime!=='application/pdf'||typeof input.content_base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.content_base64))fail('Anexe o PDF original, assinado ou relatório ITI correspondente.');
 const bytes=Buffer.from(input.content_base64,'base64');if(bytes.length<8||bytes.length>10485760||bytes.subarray(0,5).toString()!=='%PDF-')fail('Cada PDF deve ter até 10 MB.');
 const id=randomUUID(),hash=sha(bytes);return{bytes,document:{id,name:input.name.replace(/[\x00-\x1f/\\]/g,'_'),project_id:project,category,mime:'application/pdf',size:bytes.length,sha256:hash,storage_key:tenant+'/'+id+'/'+hash,requirement_id,signature_method:null,signature_review:'pending'}};
}
export function createClientPortal({store,sealer,publicOrigin,enabled=false,mailProvider,coreCall}){
 const attempts=new Map();
 function rate(req){const now=Math.floor(Date.now()/60000),key=networkAddress(req)??'unknown';for(const[k,v]of attempts)if(v.minute<now)attempts.delete(k);const n=attempts.get(key)??{minute:now,n:0};if(++n.n>90||attempts.size>10000)fail('Aguarde antes de continuar.',429);attempts.set(key,n);}
 const setCookie=(res,value,age=900)=>res.setHeader('Set-Cookie',cookie+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+age);
 const client=(s,action,data={})=>store.portalClient(s,action,data);
 function session(req){const value=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookie+'='))?.slice(cookie.length+1);const s=sealer.open('session',value);if(s?.kind!=='pee-client'||!uuid(s.tenant)||!uuid(s.invite)||!/^[a-f0-9]{64}$/.test(s.hash)||!/^[a-f0-9]{64}$/.test(s.csrf))fail('Renove seu convite com a organização responsável.',401);return s;}
 async function confirmLicense(s,action='context'){
  const context=await client(s,action);if(s.tenant==='5a0df16a-1221-439b-a6db-8ab143273a78')return;
  if(!coreCall)fail('A licença da organização não pôde ser confirmada.',503);
  const grant=await coreCall('licensed_introspect',{organization_id:'d4b48d68-4203-45b2-b709-ac931c87760e',audience:'energyos-pee',license_id:s.tenant,subject:context.created_by});
  if(grant.tenant_id!==s.tenant||grant.sub!==context.created_by)fail('Contexto da organização alterado.',403);
  if(grant.access_mode!=='full'){await store.syncLicenseHold(grant);fail('A licença da organização responsável está temporariamente indisponível. Entre em contato com ela.',403);}await store.syncLicense(grant);
 }
 function publicView(v){const requests=v.requests??[],accepted=requests.filter(r=>r.state==='accepted').length,raw=v.engine_data,flatten=x=>({...x.payload,id:x.id,version:x.version,updated_at:x.updated_at});let project_progress=null;
  if(raw){const rows=raw.records.map(x=>({...flatten(x),kind:x.kind})),data={project:flatten(raw.project),simulations:rows.filter(x=>x.kind==='simulation'),documents:rows.filter(x=>x.kind==='document'),rule:rows.find(x=>x.kind==='rule'),company:rows.find(x=>x.kind==='company'),unit:rows.find(x=>x.kind==='unit'),fingerprint:raw.technical_hash,snapshot_hash:raw.snapshot_hash},q=assessProject(data).qualification;project_progress={readiness_percent:q.readiness_percent,verified_percent:q.verified_percent,level:q.level,warning:q.warning};}
  return {name:v.name,email:v.email,project:v.project,project_progress,progress:{percent:requests.length?Math.round(accepted/requests.length*100):0,accepted,total:requests.length,label:'Documentação solicitada e aceita pelo responsável; não representa aprovação pela distribuidora.'},requests:requests.map(({tenant_id,invite_id,project_id,...r})=>r)};}
 return{
  async publicHandle(req,res,path,{jsonBody,send}){
   if(!path.startsWith('/client')&&!path.startsWith('/api/client/')&&!path.startsWith('/assets/client-'))return false;
   if(!enabled||!sealer)fail('O portal do cliente ainda não foi habilitado.',503);rate(req);
   if(req.method==='GET'&&path==='/client'){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Permissions-Policy','display-capture=(), camera=(), microphone=()');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");res.end(await readFile(new URL('web/client-portal.html',import.meta.url)));return true;
   }
   if(req.method==='GET'&&['/assets/client-portal.mjs','/assets/client-portal.css'].includes(path)){res.setHeader('Content-Type',path.endsWith('.mjs')?'application/javascript; charset=utf-8':'text/css; charset=utf-8');res.end(await readFile(new URL('web/'+path.split('/').at(-1),import.meta.url)));return true;}
   if(req.method==='POST'&&req.headers.origin!==publicOrigin)fail('Solicitação fora da área do cliente.',403);
   if(path==='/api/client/resume'&&req.method==='POST'){
    const b=await jsonBody(req,3000);if(!uuid(b.tenant)||!uuid(b.invite))fail('Confira o endereço recebido no convite.');const email=emailAddress(b.email);
    if(!mailProvider?.portal)fail('O envio do link de acesso não está disponível. Contate a organização responsável.',503);
    const token=randomBytes(32).toString('base64url');let contact=null;
    try{contact=await client({tenant:b.tenant,invite:b.invite,hash:'0'.repeat(64)},'resume_request',{email,resume_hash:sha(token)});}catch(error){if(error.status!==401&&error.status!==403&&error.code!=='42501')throw error;}
    if(contact){const url=publicOrigin+'/client#'+new URLSearchParams({tenant:b.tenant,invite:b.invite,token}).toString();try{await mailProvider.portal({id:b.invite,notice_id:randomUUID(),email:contact.email,name:contact.name,url,origin:publicOrigin,project:'seu projeto',resume:true});}catch{}}
    send(res,200,{ok:true,message:'Se o e-mail corresponder ao contato cadastrado e o convite estiver vigente, você receberá um novo link de uso único, válido por 15 minutos.'});return true;
   }
   if(path==='/api/client/exchange'&&req.method==='POST'){
    const b=await jsonBody(req,3000);if(!uuid(b.tenant)||!uuid(b.invite)||typeof b.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(b.token))fail('Convite inválido.',401);
    await confirmLicense({tenant:b.tenant,invite:b.invite,hash:sha(b.token)},'exchange_context');
    const hash=sha(randomBytes(32)),s={kind:'pee-client',tenant:b.tenant,invite:b.invite,hash,csrf:sha(randomBytes(32))};await client({...s,hash:sha(b.token)},'exchange',{session_hash:hash});setCookie(res,sealer.seal('session',s,900));send(res,200,{ok:true});return true;
   }
   const s=session(req);if(req.method==='POST'&&req.headers['x-csrf-token']!==s.csrf)fail('Atualize a área do cliente antes de continuar.',403);
   await confirmLicense(s);
   if(req.method==='GET'&&path==='/api/client/bootstrap'){send(res,200,{...publicView(await client(s,'bootstrap')),csrf:s.csrf,idle_seconds:900});return true;}
   if(req.method==='POST'&&path==='/api/client/activity'){await client(s,'activity');setCookie(res,sealer.seal('session',s,900));send(res,200,{ok:true});return true;}
   if(req.method==='POST'&&path==='/api/client/logout'){await client(s,'logout');setCookie(res,'',0);send(res,200,{ok:true});return true;}
   const original=path.match(/^\/api\/client\/requests\/([a-f0-9-]{36})\/original$/);
   if(original&&req.method==='GET'){
    const d=await client(s,'original',{id:original[1]});if(d.signature_review==='verified'||d.category==='signature_evidence'||!d.storage_key.startsWith(s.tenant+'/'))fail('Este arquivo está protegido contra exportação.',403);
    const bytes=Buffer.from(await(await store.download(d.storage_key)).arrayBuffer());if(bytes.length!==d.size||sha(bytes)!==d.sha256)fail('Integridade não confirmada.',503);res.setHeader('Content-Type',d.mime);res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(d.name));res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(bytes);return true;
   }
   const submit=path.match(/^\/api\/client\/requests\/([a-f0-9-]{36})\/submit$/);
   if(submit&&req.method==='POST'){
    const b=await jsonBody(req,43000000),v=await client(s,'bootstrap'),r=v.requests.find(x=>x.id===submit[1]);if(!r||!['requested','returned'].includes(r.state)||b.version!==r.version)fail('A solicitação mudou. Atualize antes de anexar.',409);
    const answers=validatePortalFields(r.fields,b.answers),context={tenant:s.tenant,project:r.project_id},signed=portalFile(b.signed,{...context,category:'signature_evidence'}),evidence=portalFile(b.evidence,{...context,category:'signature_evidence'}),files=[signed,evidence];let originalId=r.original_id;
    if(!originalId){const f=portalFile(b.original,{...context,category:r.category,requirement_id:r.requirement_id});if(r.simulation_id)f.document.simulation_id=r.simulation_id;files.push(f);originalId=f.document.id;}
    if(new Set(files.map(f=>f.document.sha256)).size!==files.length)fail('Original, versão assinada e relatório devem ser arquivos distintos.');
    for(const f of files)await store.upload(f.document.storage_key,f.bytes,f.document.mime);
    const result=await client(s,'submit',{id:r.id,version:r.version,answers,original_id:originalId,signed_id:signed.document.id,evidence_id:evidence.document.id,documents:files.map(f=>f.document)});send(res,200,publicView(result));return true;
   }
   fail('Recurso não disponível nesta área.',404);
  },
  async workspaceHandle(req,res,path,c,{jsonBody,send,get}){
   if(!path.startsWith('/api/app/portal'))return false;if(!enabled)fail('O portal do cliente ainda não foi habilitado.',503);
   const manage=(action,data)=>store.portalManage(c,action,data),q=new URL(req.url,'http://local.invalid').searchParams;
   if(req.method==='GET'&&path==='/api/app/portal'){if(!uuid(q.get('project_id')))fail('Selecione um projeto.');send(res,200,await manage('list',{project_id:q.get('project_id')}));return true;}
   if(req.method!=='POST')fail('Recurso não encontrado.',404);const b=await jsonBody(req,50000);
   if(path==='/api/app/portal/invite'){
    if(!['editor','manager'].includes(c.role))fail('Somente elaborador ou gestor pode convidar clientes.',403);const project=await get(c,b.project_id,'project');if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>200)fail('Informe o nome do cliente.');if(b.send_email===true&&!mailProvider?.portal)fail('O envio de convites pelo Resend não está disponível.',503);const id=randomUUID(),token=randomBytes(32).toString('base64url');const invite=await manage('invite',{id,project_id:b.project_id,client_id:randomUUID(),name:b.name.trim(),email:emailAddress(b.email),token_hash:sha(token)}),url=publicOrigin+'/client#'+new URLSearchParams({tenant:c.tenant,invite:id,token}).toString();let mail_state='not_requested';
    if(b.send_email===true){try{const sent=await mailProvider.portal({id,email:invite.email,name:invite.name,url,origin:publicOrigin,project:project.name});mail_state='accepted';await manage('mail_result',{invite_id:id,state:mail_state,provider_id:sent.id});}catch{mail_state='unknown';await manage('mail_result',{invite_id:id,state:mail_state,provider_id:null});}}
    send(res,201,{invite,url,mail_state,notice:'Convite pessoal de uso único, válido por sete dias. Envie somente ao contato identificado.'});return true;
   }
   if(!uuid(b.invite_id))fail('Convite inválido.');
   if(path==='/api/app/portal/request'){
    if(!['editor','manager'].includes(c.role))fail('Seu perfil não permite solicitar documentos.',403);if(!categories.includes(b.category)||typeof b.title!=='string'||b.title.trim().length<3||b.title.length>300||typeof b.instructions!=='string'||b.instructions.length>10000)fail('Confira o título, as instruções e a categoria.');
    if(b.category==='manufacturer_manual'){const list=await manage('list',{project_id:b.project_id});const invite=list.invites.find(i=>i.id===b.invite_id),sim=await get(c,b.simulation_id,'simulation');if(!invite||sim.project_id!==invite.project_id)fail('Vincule o manual à medida deste projeto.');}
    send(res,201,await manage('request',{...b,id:randomUUID(),fields:validatePortalFields(b.fields),original_id:uuid(b.original_id)?b.original_id:null,requirement_id:uuid(b.requirement_id)?b.requirement_id:null}));return true;
   }
   if(path==='/api/app/portal/review'){send(res,200,await manage('review',b));return true;}
   if(path==='/api/app/portal/revoke'){send(res,200,await manage('revoke',b));return true;}fail('Operação não disponível.',404);
  }
 };
}
