import{createSubmissionNotifications}from'./submission-notifications.mjs';
import {validateSubmissionMail,requireEvaluationContact}from'./distributor-contact.mjs';
import {isProtectedDocument}from'./document-control.mjs';
import {randomUUID,randomBytes,createHash}from'node:crypto';
import {ProjectError}from'./project-policy.mjs';
import {assessProject}from'./evaluation.mjs';
import {validateCommunication,projectCommunication,communicationHtml,communicationHash,enforceMailboxOwner,inboundText,emailAddress}from'./communications-policy.mjs';
import {verifyResendEvent,ResendFailure}from'./resend-provider.mjs';
import {downloadReceivedAttachment}from'./mail-attachments.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fail=(message,status=422)=>{throw new ProjectError(message,status);};
const fileTypes=new Set(['application/pdf','image/png','image/jpeg','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const cleanName=v=>String(v??'anexo').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,200);
export function createCommunications({store,snapshot,workspace,provider=null,webhookSecret=null,readAttachment=downloadReceivedAttachment,publicOrigin}={}){
 const protection=process.env.PEE_CONTENT_PROTECTION_ENABLED==='true',notifications=createSubmissionNotifications({store,provider,publicOrigin,enabled:protection});
 let activeSend=false,archiving=false;const sendLimits=new Map();
 const user=(c,action,data={})=>store.mail(c,action,data),system=(action,data={})=>store.mailSystem(action,data);
 const own=(r,c)=>enforceMailboxOwner(r,c),write=c=>{if(!['editor','manager'].includes(c.role))fail('Somente elaboradores e gestores podem enviar comunicações.',403);};
 async function dataForDraft(c,thread,input,author,grant){
  const draft=validateCommunication(input),data=await snapshot(c,thread.project_id);if(!data.company||!data.unit)fail('Complete o beneficiário e a unidade do projeto.');
  const protectedFlow=process.env.PEE_CONTENT_PROTECTION_ENABLED==='true';
  if(protectedFlow&&draft.purpose==='submission'){
   const contact=requireEvaluationContact(data.rule,{mail:true});
   if(!grant?.email||c.source==='licensed'&&!grant.license_buyer_email)fail('Confirme no Core os e-mails do responsável pelo envio e do contratante antes da apresentação final.');
   draft.to=[contact.to];draft.cc=[...new Set((contact.cc??[]).map(emailAddress))].filter(x=>x!==contact.to);draft.bcc=[];draft.notification_recipients=[...new Set([grant.license_buyer_email,grant.email].filter(Boolean).map(emailAddress))];draft.document_ids=data.documents.filter(d=>d.project_id===data.project.id&&d.category!=='signature_evidence'&&d.signature_review==='verified').map(d=>d.id);
  }
  const ids=new Set();for(const id of draft.document_ids){const d=data.documents.find(d=>d.id===id&&d.project_id===data.project.id);if(!d)fail('Anexo não pertence a este projeto.',404);
   if(protectedFlow&&isProtectedDocument(d,data.documents)&&draft.purpose!=='submission')fail('Documentos assinados ou validados só podem ser enviados pelo fluxo final à distribuidora.',403);
   if(protectedFlow&&draft.purpose==='submission'&&d.category!=='signature_evidence'&&d.signature_review==='verified'){
    if(!d.signed_document_id||!d.signature_evidence_id)fail('Faltam os vínculos da versão assinada e do relatório de validação.');ids.add(d.signed_document_id);ids.add(d.signature_evidence_id);if(d.category==='manufacturer_manual')ids.add(d.id);
   }else ids.add(id);
  }
  if(ids.size>40)fail('O conjunto excede 40 arquivos. Confira o canal e os limites do edital antes de apresentar.');
  const documents=[...ids].map(id=>{const d=data.documents.find(d=>d.id===id&&d.project_id===data.project.id);if(!d)fail('Uma evidência não pertence ao projeto.',404);return{id:d.id,name:d.name,mime:d.mime,sha256:d.sha256,size:d.size};});
  if(documents.reduce((n,d)=>n+d.size,0)>20971520)fail('Os anexos da comunicação devem totalizar até 20 MB.');
  const analysis=assessProject(data);let submission_issues=[];try{validateSubmissionMail(draft,data,analysis);}catch(e){if(!(e instanceof ProjectError))throw e;submission_issues=[e.message];}
  const body=projectCommunication({draft,project:data.project,company:data.company,unit:data.unit,analysis,workspace:data.workspace??workspace,author,projectCode:thread.project_code});
  const payload={...draft,project_id:data.project.id,project_name:data.project.name,submission_issues,body,html:communicationHtml(draft.subject,body),sender_name:author,documents,snapshot_hash:data.snapshot_hash,project_version:data.project.version,prepared_at:new Date().toISOString()};
  return {...payload,preview_hash:communicationHash(payload)};
 }
 async function privateFiles(c,message){return user(c,'files',{message_id:message.id});}
 return {enabled:!!provider,
  async handle(req,res,path,c,grant,{jsonBody,send,reauthorize}){
   if(!path.startsWith('/api/app/communications'))return false;
   if(path==='/api/app/communications'&&req.method==='GET'){send(res,200,{enabled:!!provider,from:provider?.configuration.from??null,threads:await user(c,'list')});return true;}
   if(path==='/api/app/communications/threads'&&req.method==='POST'){
    write(c);const b=await jsonBody(req);if(!uuid(b.project_id))fail('Selecione um projeto.');const data=await snapshot(c,b.project_id);
    const thread=await user(c,'new_thread',{id:randomUUID(),project_id:b.project_id,subject:data.project.name,reply_token:randomBytes(32).toString('base64url')});send(res,201,thread);return true;
   }
   const threadRoute=path.match(/^\/api\/app\/communications\/threads\/([a-f0-9-]{36})$/);
   if(threadRoute&&req.method==='GET'){
    const before=new URL(req.url,'http://local.invalid').searchParams.get('before');if(before&&!/^[1-9]\d{0,15}$/.test(before))fail('Paginação inválida.');
    const result=await user(c,'thread',{id:threadRoute[1],before});own(result.thread,c);
    if(protection)for(const m of result.messages)m.private_notifications=await notifications.list(c,m);
    result.messages=result.messages.map(m=>{own(m,c);return {...m,payload:{...m.payload,html:undefined}};});
    send(res,200,{...result,has_older:result.messages.length===100,next_before:result.messages[0]?.ordinal??null});return true;
   }
   if(path==='/api/app/communications/drafts'&&req.method==='POST'){
    write(c);const b=await jsonBody(req);if(!uuid(b.thread_id)||b.id&&!uuid(b.id))fail('Comunicação inválida.');
    const {thread}=await user(c,'thread',{id:b.thread_id});own(thread,c);const payload=await dataForDraft(c,thread,b,grant.display_name,grant);
    if(b.in_reply_to_id){if(!uuid(b.in_reply_to_id))fail('Resposta inválida.');const parent=own(await user(c,'message',{id:b.in_reply_to_id}),c);if(parent.thread_id!==thread.id||parent.direction!=='inbound')fail('A resposta não pertence à conversa.');payload.in_reply_to=typeof parent.payload.message_id==='string'&&!/[\s\x00-\x1f]/.test(parent.payload.message_id)?parent.payload.message_id:null;payload.in_reply_to_id=parent.id;payload.preview_hash=communicationHash({...payload,preview_hash:undefined});}
    const message=await user(c,'draft',{id:b.id??randomUUID(),thread_id:thread.id,expected_version:b.id?Number(b.version):0,payload});send(res,b.id?200:201,message);return true;
   }
   const sending=path.match(/^\/api\/app\/communications\/messages\/([a-f0-9-]{36})\/send$/);
   if(sending&&req.method==='POST'){
    write(c);if(!provider)fail('O Resend ainda não está habilitado para este ambiente.',503);const b=await jsonBody(req);
    if(b.confirm!==true||b.destination_confirmed!==true)fail('Confira os destinatários, as cópias, os anexos e confirme o envio.');
    const message=own(await user(c,'message',{id:sending[1]}),c),{thread}=await user(c,'thread',{id:message.thread_id});own(thread,c);
    if(b.version!==message.version||b.preview_hash!==message.payload.preview_hash)fail('A prévia mudou. Atualize antes de confirmar.',409);
    if(['accepted','delivered','bounced','complained','delivery_delayed','suppressed'].includes(message.state)){await notifications.schedule(c,message);send(res,200,message);return true;}
    const data=await snapshot(c,thread.project_id);if(data.snapshot_hash!==message.payload.snapshot_hash)fail('O projeto mudou após a preparação. Atualize o rascunho e revise a nova prévia.',409);
    validateSubmissionMail(message.payload,data,assessProject(data));
    if(activeSend)fail('Outro envio está sendo confirmado. Aguarde.',429);
    const minute=Math.floor(Date.now()/60000),key=c.tenant+':'+c.subject;for(const[k,v]of sendLimits)if(v.minute<minute)sendLimits.delete(k);const count=sendLimits.get(key)??{minute,count:0};if(++count.count>3)fail('Limite de três confirmações de envio por minuto.',429);sendLimits.set(key,count);
    activeSend=true;
    try{
     const attachments=[];let size=0;
     for(const d of message.payload.documents){const current=data.documents.find(x=>x.id===d.id&&x.sha256===d.sha256);if(!current)fail('Um anexo mudou. Refaça a prévia.',409);const r=await store.download(current.storage_key),bytes=Buffer.from(await r.arrayBuffer());size+=bytes.length;if(bytes.length!==d.size||hash(bytes)!==d.sha256||size>20971520)fail('Integridade ou limite dos anexos não confirmado.',409);attachments.push({name:cleanName(d.name),mime:d.mime,bytes});}
     const refreshed=await reauthorize();if(protection&&message.payload.purpose==='submission'){const expected=[...new Set([refreshed.grant.license_buyer_email,refreshed.grant.email].filter(Boolean).map(emailAddress))];if(JSON.stringify(expected)!==JSON.stringify(message.payload.notification_recipients))fail('Os responsáveis pelas cópias mudaram no Core. Refaça a prévia.',409);}
     const lease=randomBytes(32).toString('hex'),prepared=await user(c,'start_send',{id:message.id,expected_version:message.version,preview_hash:message.payload.preview_hash,lease_hash:hash(lease)});
     if(prepared.state!=='sending'){send(res,200,prepared);return true;}
     let result;
     try{result=await provider.send({message:{...message.payload,id:message.id},thread,attachments});}
     catch(error){const unknown=error instanceof ResendFailure&&error.uncertain;await user(c,'finish_send',{id:message.id,lease_hash:hash(lease),state:unknown?'unknown':'failed',code:unknown?'RESEND_UNCONFIRMED':'RESEND_FAILED'});fail(unknown?'O envio ficou sem confirmação. Atualize a conversa antes de tentar novamente.':'O provedor não confirmou o envio. Revise a comunicação antes de preparar outro envio.',503);}
     const saved=await user(c,'finish_send',{id:message.id,lease_hash:hash(lease),state:'accepted',provider_id:result.id,code:'RESEND_ACCEPTED'});
     await notifications.schedule(c,saved);
     for(const event of await system('pending_delivery',{provider_id:result.id}))await system('apply',event);
     send(res,200,saved);return true;
    }finally{activeSend=false;}
   }
   const filesRoute=path.match(/^\/api\/app\/communications\/messages\/([a-f0-9-]{36})\/files(?:\/([a-f0-9-]{36}))?$/);
   if(filesRoute&&req.method==='GET'){
    const message=own(await user(c,'message',{id:filesRoute[1]}),c),files=await privateFiles(c,message);
    if(!filesRoute[2]){send(res,200,{files:files.map(({storage_key,...f})=>f),archive_status:message.payload.attachment_archive_status??null});return true;}
    const file=files.find(f=>f.id===filesRoute[2]);if(!file)fail('Anexo não disponível na sua caixa.',404);own(file,c);
    const r=await store.download(file.storage_key),bytes=Buffer.from(await r.arrayBuffer());if(bytes.length!==file.size||hash(bytes)!==file.sha256)fail('A integridade do anexo não foi confirmada.',409);
    await reauthorize();res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(cleanName(file.name)));res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(bytes);return true;
   }
   fail('Operação de comunicação não encontrada.',404);
  },
  async webhook(req,res){
   if(!provider||!webhookSecret){res.writeHead(503).end();return;}
   let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>1000000){res.writeHead(413).end();return;}parts.push(part);}
   let verified;try{verified=verifyResendEvent(Buffer.concat(parts).toString('utf8'),req.headers,webhookSecret);}catch{res.writeHead(401).end();return;}
   const {event}=verified,id=event.data.email_id;
   const supported=['email.received','email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed'];if(!supported.includes(event.type)){res.writeHead(200).end();return;}
   if(event.type!=='email.received'&&typeof event.data.from==='string'){
    const from=event.data.from.match(/<([^<>]+)>/)?.[1]??event.data.from;
    try{if(emailAddress(from)!==provider.configuration.from){res.writeHead(200).end();return;}}catch{res.writeHead(200).end();return;}
   }
   if(!Number.isFinite(Date.parse(event.created_at))){res.writeHead(400).end();return;}
   const input={event_id:verified.id,payload_hash:verified.hash,event_type:event.type,provider_id:id,provider_created_at:event.created_at,route_type:'provider',route_key:id};
   if(event.type==='email.received'){
    // Discard unrelated account mail BEFORE fetching any body using the receiving credential.
    const eventDestinations=[...(Array.isArray(event.data.to)?event.data.to:[]),event.data.received_for].filter(v=>typeof v==='string').slice(0,100),routes=[];
    for(const raw of new Set(eventDestinations)){const m=/^p-([A-Za-z0-9_-]{43})@([^@]+)$/.exec(raw);if(m&&m[2].toLowerCase()===provider.configuration.receivingDomain){const key=hash(m[1]),r=await system('route',{route_type:'reply',route_key:key});if(r&&!routes.some(x=>x.route_key===key))routes.push({...r,route_key:key});}}
    if(routes.length!==1){res.writeHead(200).end();return;}
    const email=await provider.received(id);if(email.id!==id)throw Error('MAIL_RECEIPT_ID');
    const destinations=[...(Array.isArray(email.to)?email.to:[]),email.received_for].filter(v=>typeof v==='string').slice(0,100);
    if(!destinations.some(raw=>raw==='p-'+eventDestinations.map(x=>/^p-([A-Za-z0-9_-]{43})@/.exec(x)?.[1]).find(token=>token&&hash(token)===routes[0].route_key)+'@'+provider.configuration.receivingDomain)){res.writeHead(200).end();return;}
    const attachments=(Array.isArray(email.attachments)?email.attachments:[]).slice(0,100).filter(a=>uuid(a.id)).map(a=>({id:a.id,name:cleanName(a.filename),mime:String(a.content_type??'application/octet-stream').slice(0,150),size:Number(a.size)||0}));
    input.route_type='reply';input.route_key=routes[0].route_key;input.message_id=randomUUID();input.payload={direction:'inbound',provider_id:id,subject:String(email.subject??'Sem assunto').slice(0,300),from:String(email.from??'').slice(0,500),to:destinations.map(s=>s.slice(0,300)),cc:Array.isArray(email.cc)?email.cc.slice(0,50).map(s=>String(s).slice(0,300)):[],body:inboundText(email).slice(0,50000),message_id:typeof email.message_id==='string'?email.message_id.slice(0,500):null,attachments,authentication:email.authentication&&JSON.stringify(email.authentication).length<4000?email.authentication:null,attachments_archived:attachments.length===0};
   }
   await system('apply',input);res.writeHead(200).end();
  },
  async archive(){
   if(!provider||archiving)return;archiving=true;
   try{await notifications.process();for(const job of await system('pending_files')){
    let complete=true,status='archived';const cached=await system('files',{provider_id:job.provider_id});let total=cached.reduce((n,f)=>n+f.size,0);
    for(const a of job.attachments??[]){
     if(cached.some(f=>f.provider_attachment_id===a.id))continue;
     if(!fileTypes.has(a.mime)||a.size<1||a.size>20971520||(total+=a.size)>20971520){status='unsupported_or_size_limit';continue;}
     try{const detail=await provider.attachment(job.provider_id,a.id);if(detail.id!==a.id||detail.size!==a.size||detail.content_type!==a.mime)throw Error('MAIL_ATTACHMENT_METADATA');const bytes=await readAttachment(detail,job.provider_id),id=randomUUID(),sha256=hash(bytes),storage_key=job.tenant_id+'/'+id+'/'+sha256;await store.upload(storage_key,bytes,a.mime);await system('store_file',{provider_id:job.provider_id,id,provider_attachment_id:a.id,name:cleanName(a.name),mime:a.mime,size:bytes.length,sha256,storage_key});}
     catch{complete=false;status='retry_pending';}
    }
    await system('archive_status',{provider_id:job.provider_id,complete,status});
   }}finally{archiving=false;}
  }
 };
}
