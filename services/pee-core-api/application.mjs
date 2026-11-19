import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {ProjectError,text,number,validateSimulation,projectIssues,validateTransition,requiredSections} from './project-policy.mjs';
import {renderReport,reportTypes} from './reports.mjs';
import {opportunityInputs,types} from './engineering.mjs';
import {createStore} from './store.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(message,status=422)=>{throw new ProjectError(message,status);};
const kinds=['company','unit','project','simulation','document','rule','workflow','communication','royalty'];
const flatten=r=>({...r.payload,id:r.id,version:r.version,created_at:r.created_at,updated_at:r.updated_at});
async function jsonBody(req,max=600000){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))fail('Use JSON.',415);const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>max)fail('Arquivo ou dados excedem o limite.',413);chunks.push(part);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('Dados inválidos.');}}
const mimeTypes=['application/pdf','image/jpeg','image/png','text/csv','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const categories=['manufacturer_manual','bills','baseline','diagram','art','budgets','mv_plan','consent','signature_evidence','official_decision','edital','other'];
function validFile(bytes,mime){if(mime==='application/pdf')return bytes.subarray(0,5).toString()==='%PDF-';if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(mime.endsWith('spreadsheetml.sheet'))return bytes[0]===80&&bytes[1]===75;return !bytes.includes(0)&&!/<(?:script|iframe|html)\b/i.test(bytes.toString('utf8'));}
export function createApplication({store=createStore(),publicOrigin,coreOrigin,workspace='Expert Energy',coreCall,activityEnabled=false}={}){
 const limits=new Map();
 function limit(c,method){
  const now=Date.now(),key=c.tenant+':'+c.subject,minute=Math.floor(now/60000);let counter=limits.get(key);
  if(!counter||counter.minute!==minute){if(limits.size>10000){for(const[k,v]of limits)if(v.minute<minute-2)limits.delete(k);if(limits.size>10000)fail('Aguarde antes de continuar.',429);}counter={minute,reads:0,writes:0};limits.set(key,counter);}
  const field=method==='GET'?'reads':'writes';counter[field]++;if(counter[field]>(field==='reads'?120:30))fail('Limite por minuto atingido. Aguarde para continuar.',429);
 }
 const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
 const list=async(c,kind)=>(await store.rpc(c,'list',{kind})).map(flatten);
 async function get(c,id,kind){if(!uuid(id))fail('Identificador inválido.');const raw=await store.rpc(c,'get',{id});if(kind&&raw.kind!==kind)fail('Registro não encontrado.',404);return flatten(raw);}
 async function related(c,id,kind){return get(c,id,kind);}
 async function snapshot(c,id){const p=await related(c,id,'project');const [simulations,documents,rules,companies,units]=await Promise.all(['simulation','document','rule','company','unit'].map(k=>list(c,k)));return {project:p,simulations,documents,rule:rules.find(r=>r.id===p.rule_id),company:companies.find(r=>r.id===p.company_id),unit:units.find(r=>r.id===p.unit_id),workspace,actor:c.subject};}
 async function put(c,kind,id,version,payload){return flatten(await store.rpc(c,'put',{kind,id,expected_version:version,payload}));}
 function write(c){if(!['editor','manager','reviewer'].includes(c.role))fail('Seu perfil permite somente consulta.',403);}
 function review(c){if(!['reviewer','manager'].includes(c.role))fail('Revisão exige perfil de revisão técnica ou gestor.',403);}
 async function validate(c,kind,x,old){
  if(!x||typeof x!=='object'||Array.isArray(x))fail('Dados inválidos.');
  if(kind==='company'){return {name:text(x.name,'razão social'),cnpj:text(x.cnpj,'CNPJ',30),representative:text(x.representative,'representante'),email:text(x.email,'e-mail',254),phone:String(x.phone??'').slice(0,50),address:text(x.address,'endereço',1000)};}
  if(kind==='unit'){await related(c,x.company_id,'company');return {company_id:x.company_id,name:text(x.name,'nome da unidade'),uc:text(x.uc,'unidade consumidora',80),address:text(x.address,'endereço',1000),distributor:text(x.distributor,'distribuidora'),tariff:String(x.tariff??'').slice(0,200),annual_mwh:number(x.annual_mwh??0,'consumo anual'),peak_kw:number(x.peak_kw??0,'demanda na ponta')};}
  if(kind==='project'){
   const unit=await related(c,x.unit_id,'unit');if(unit.company_id!==x.company_id)fail('Unidade não pertence à empresa selecionada.');await related(c,x.company_id,'company');
   const sections={};for(const k of Object.keys(requiredSections))sections[k]=String(x.sections?.[k]??'').slice(0,20000);
   if(x.rule_id)await related(c,x.rule_id,'rule');
   let url='';if(x.call_url){const u=new URL(x.call_url);if(u.protocol!=='https:'||u.username||u.password)fail('Informe o link HTTPS oficial do edital.');url=u.href;}
   const e=x.economics??{},economics={energy_cost:number(e.energy_cost??0,'custo evitado de energia'),demand_cost:number(e.demand_cost??0,'custo evitado de demanda'),discount_rate:number(e.discount_rate??8,'taxa de desconto',0,100),shared_cost:number(e.shared_cost??0,'custos compartilhados'),shared_life:number(e.shared_life??10,'vida útil dos custos compartilhados',1,60),coincidence_confirmed:e.coincidence_confirmed===true};
   const answers={};for(const [k,v]of Object.entries(x.requirement_answers??{})){if(!uuid(k))fail('Exigência inválida.');answers[k]={answer:String(v?.answer??'').slice(0,10000)};}
   return {name:text(x.name,'nome do projeto'),company_id:x.company_id,unit_id:x.unit_id,distributor:unit.distributor,call_name:String(x.call_name??'').slice(0,300),call_url:url,rule_id:x.rule_id||null,sections,economics,requirement_answers:answers,phase:old?.phase??'Elaboração'};
  }
  if(kind==='simulation'){await related(c,x.project_id,'project');const s=validateSimulation(x);const all=await list(c,'simulation');if(s.selected&&all.some(a=>a.id!==old?.id&&a.project_id===s.project_id&&a.selected&&a.boundary.toLocaleLowerCase('pt-BR')===s.boundary.toLocaleLowerCase('pt-BR')))fail('Já existe medida selecionada nesta fronteira.');return s;}
  if(kind==='rule'){
   review(c);const u=new URL(x.source_url);if(u.protocol!=='https:'||u.username||u.password)fail('Fonte do edital inválida.');
   if(!Array.isArray(x.requirements)||x.requirements.length>200)fail('Lista de exigências inválida.');
   return {name:text(x.name,'nome do edital'),distributor:text(x.distributor,'distribuidora'),edition:text(x.edition,'versão do edital',100),source_url:u.href,reviewed:x.reviewed===true,max_rcb:x.max_rcb==null?null:number(x.max_rcb,'RCB máxima',0.001,100),requirements:x.requirements.map(r=>({id:uuid(r.id)?r.id:randomUUID(),label:text(r.label,'exigência',2000),document_required:r.document_required===true})),reviewed_by:c.subject,reviewed_at:new Date().toISOString()};
  }
  fail('Use a operação específica deste módulo.',403);
 }
 return {async handle(req,res,path,authorize){
  if(req.method==='GET'&&path==='/commercial'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");res.end(await readFile(new URL('web/commercial.html',import.meta.url)));return true;
  }
  if(req.method==='GET'&&path==='/assets/comercial.mp4'){
   const file=new URL('web/comercial.mp4',import.meta.url),size=(await stat(file)).size;res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
   if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return true;}
    const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;if(start>=size||start>end){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return true;}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});createReadStream(file,{start,end}).pipe(res);return true;
   }res.setHeader('Content-Length',size);createReadStream(file).pipe(res);return true;
  }
  if(req.method==='GET'&&path.startsWith('/assets/')){
   const assets={'/assets/app.js':['application/javascript; charset=utf-8','web/app.js'],'/assets/activity.mjs':['application/javascript; charset=utf-8','web/activity.mjs'],'/assets/app.css':['text/css; charset=utf-8','web/app.css'],'/assets/logo.png':['image/png','web/logo.png'],'/assets/favicon.ico':['image/x-icon','web/favicon.ico'],'/assets/comercial.vtt':['text/vtt; charset=utf-8','web/comercial.vtt'],'/assets/comercial-poster.jpg':['image/jpeg','web/comercial-poster.jpg']};
   const match=assets[path];if(!match)return false;res.setHeader('Content-Type',match[0]);res.setHeader('Content-Security-Policy',"default-src 'none'");res.end(await readFile(new URL(match[1],import.meta.url)));return true;
  }
  if(path!=='/app'&&!path.startsWith('/api/app/'))return false;
  const {session:s,grant:g}=await authorize(req);const c={source:'core',tenant:s.tenant,subject:s.subject,role:g.role,monthly_limit:g.monthly_project_limit};
  limit(c,req.method);
  if(req.method==='GET'&&path==='/app'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");res.end(await readFile(new URL('web/index.html',import.meta.url)));return true;
  }
  if(req.method!=='GET'){if(req.headers.origin!==publicOrigin||req.headers['x-csrf-token']!==s.csrf)fail('Confirme novamente seu acesso para continuar.',403);}
  if(req.method==='GET'&&path==='/api/app/bootstrap'){
   const data=Object.fromEntries(await Promise.all(kinds.map(async k=>[k,await list(c,k)])));send(res,200,{identity:{workspace,role:c.role,subject:c.subject,monthly_limit:c.monthly_limit,csrf:s.csrf,expires_at:g.expires_at,core_url:coreOrigin+'/pee',activity_enabled:activityEnabled,idle_seconds:900},types,inputs:opportunityInputs,reports:reportTypes,sections:requiredSections,data});return true;
  }
  if(req.method==='GET'&&path==='/api/app/audit'){send(res,200,{items:await store.rpc(c,'audit')});return true;}
  const record=path.match(/^\/api\/app\/records\/(company|unit|project|simulation|rule)(?:\/([a-f0-9-]{36}))?$/);
  if(record&&req.method==='POST'){
   write(c);const body=await jsonBody(req),id=record[2]??randomUUID(),version=record[2]?number(body.version,'versão',1,1e9):0,old=record[2]?await get(c,id,record[1]):null;
   if(record[1]==='project'&&c.role==='reviewer')fail('Seu perfil de revisão não altera o projeto técnico.',403);
   const payload=await validate(c,record[1],body,old);send(res,record[2]?200:201,await put(c,record[1],id,version,payload));return true;
  }
  const analysis=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/analysis$/);
  if(analysis&&req.method==='GET'){const data=await snapshot(c,analysis[1]);send(res,200,projectIssues(data.project,data.simulations,data.documents,data.rule));return true;}
  const report=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/reports\/(final|presentation|diagnosis|memorial|mv|economics|schedule|documents)$/);
  if(report&&req.method==='POST'){
   write(c);const body=await jsonBody(req),data=await snapshot(c,report[1]),html=renderReport(data,report[2]),hash=digest(html);
   if(report[2]==='final'){if(!uuid(body.request_id))fail('Identificador de emissão obrigatório.');await store.rpc(c,'emit',{id:body.request_id,project_id:report[1],document_hash:hash,monthly_limit:c.monthly_limit});}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="EnergyOS-PEE-${report[1]}-${report[2]}.html"`);res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; sandbox");res.setHeader('X-Document-SHA256',hash);res.end(html);return true;
  }
  if(path==='/api/app/documents'&&req.method==='POST'){
   write(c);if(c.role==='reviewer')fail('A revisão não inclui upload de documentos do elaborador.',403);
   const body=await jsonBody(req,29000000);await related(c,body.project_id,'project');if(body.simulation_id){const sim=await related(c,body.simulation_id,'simulation');if(sim.project_id!==body.project_id)fail('Medida pertence a outro projeto.');}
   if(!categories.includes(body.category)||!mimeTypes.includes(body.mime)||typeof body.content_base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.content_base64))fail('Tipo de documento inválido.');
   const bytes=Buffer.from(body.content_base64,'base64');if(!bytes.length||bytes.length>20971520||!validFile(bytes,body.mime))fail('Arquivo inválido ou acima de 20 MB.');
   const id=randomUUID(),hash=digest(bytes),key=c.tenant+'/'+id+'/'+hash;await store.upload(key,bytes,body.mime);
   const payload={name:text(body.name,'nome do arquivo',200),project_id:body.project_id,simulation_id:body.simulation_id||null,category:body.category,mime:body.mime,size:bytes.length,sha256:hash,storage_key:key,signature_method:null,signature_evidence_id:null,signature_review:'pending',requirement_id:uuid(body.requirement_id)?body.requirement_id:null};
   send(res,201,await put(c,'document',id,0,payload));return true;
  }
  const download=path.match(/^\/api\/app\/documents\/([a-f0-9-]{36})\/download$/);
  if(download&&req.method==='GET'){
   const doc=await related(c,download[1],'document');if(!doc.storage_key.startsWith(c.tenant+'/'))fail('Documento fora deste workspace.',403);
   const response=await store.download(doc.storage_key),bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>20971520||digest(bytes)!==doc.sha256)fail('Não foi possível confirmar a integridade do arquivo.',503);
   res.setHeader('Content-Type',doc.mime);res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(doc.name));res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(bytes);return true;
  }
  const signature=path.match(/^\/api\/app\/documents\/([a-f0-9-]{36})\/signature$/);
  if(signature&&req.method==='POST'){
   review(c);const d=await related(c,signature[1],'document'),body=await jsonBody(req),evidence=await related(c,body.evidence_id,'document');
   if(d.id===evidence.id||evidence.project_id!==d.project_id||evidence.category!=='signature_evidence'||!['gov','notarized','provider'].includes(body.method))fail('Anexe a comprovação da assinatura deste projeto.');
   if(body.confirm!==true||typeof body.note!=='string'||body.note.trim().length<20)fail('Registre o resultado e a referência da conferência da assinatura.');
   send(res,200,await put(c,'document',d.id,number(body.version,'versão',1),{...d,signature_method:body.method,signature_evidence_id:evidence.id,signature_review:'verified',reviewer:c.subject,review_note:body.note.slice(0,2000),reviewed_at:new Date().toISOString()}));return true;
  }
  const workflow=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/phase$/);
  if(workflow&&req.method==='POST'){
   review(c);const body=await jsonBody(req),data=await snapshot(c,workflow[1]),check=projectIssues(data.project,data.simulations,data.documents,data.rule),transition=validateTransition(data.project,body.phase,check,body.decision);
   if(body.decision?.document_id){const d=await related(c,body.decision.document_id,'document');if(d.project_id!==workflow[1]||d.category!=='official_decision')fail('Comprove com documento oficial deste projeto.');}
   const p=await put(c,'project',data.project.id,number(body.version,'versão',1),{...data.project,phase:transition.phase,decision:transition.decision});await put(c,'workflow',randomUUID(),0,{project_id:p.id,...transition,note:String(body.note??'').slice(0,4000),actor:c.subject,at:new Date().toISOString()});send(res,200,p);return true;
  }
  send(res,404,{message:'Operação não encontrada.'});return true;
 }};
}
