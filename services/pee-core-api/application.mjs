import{createControlledViews,controlledPage}from'./controlled-view.mjs';
import{createDemonstrationApi}from'./demonstration-api.mjs';
import{demonstrationPresentation}from'./demonstration.mjs';
import {officialTemplateResources}from'./template-official-resources.mjs';
import{networkAddress}from'./network-address.mjs';
import{renderDocumentPage}from'./document-viewer.mjs';
import {requireDocumentExport,isProtectedDocument}from'./document-control.mjs';
import {createClientPortal} from './client-portal.mjs';
import {renderProjectPdf,renderProjectWorkbook,renderBrandedPdf} from './report-documents.mjs';
import {templateCatalog,renderTemplate,templateBinding} from './template-library.mjs';
import {portfolioRow} from './portfolio.mjs';
import {evaluationContact,preserveEvaluationContact,requireEvaluationContact} from './distributor-contact.mjs';
import {prepareProjectPackage} from './project-package.mjs';
import {handleDocumentSignatures} from './document-signatures.mjs';
import {createCommunications} from './communications.mjs';
import {resendConfiguration,createResendProvider} from './resend-provider.mjs';
import {integratedProgress} from './project-progress.mjs';
import {scoringMethods,scoringMetrics} from './scoring.mjs';
import {enrichAudit,auditCsv} from './audit.mjs';
import {distributors,officialSources,assistanceFields,assistFromOfficialSources} from './official-sources.mjs';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {ProjectError,text,number,validateSimulation,projectIssues,validateTransition,requiredSections} from './project-policy.mjs';
import {renderReport,reportTypes} from './reports.mjs';
import {opportunityInputs,types} from './engineering.mjs';
import {createStore} from './store.mjs';
import {validCnpj,parseLoadCurve,validateMv,mvIssues,validateResources,resourceSummary,validateSchedule,scoreProject} from './project-detail.mjs';
import {evaluateProject,assessProject,guideReference,selectionCriteria} from './evaluation.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(message,status=422)=>{throw new ProjectError(message,status);};
const typologies=['Industrial','Comércio e Serviços','Poder Público','Serviços Públicos','Rural','Residencial','Iluminação Pública'];
const kinds=['company','unit','project','simulation','document','rule','workflow','communication','royalty'];
const flatten=r=>({...r.payload,id:r.id,version:r.version,created_by:r.created_by,updated_by:r.updated_by,created_at:r.created_at,updated_at:r.updated_at});
async function jsonBody(req,max=600000){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))fail('Use JSON.',415);const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>max)fail('Arquivo ou dados excedem o limite.',413);chunks.push(part);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('Dados inválidos.');}}
const mimeTypes=['application/pdf','image/jpeg','image/png','text/csv','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const categories=['manufacturer_manual','bills','baseline','diagram','art','budgets','mv_plan','consent','signature_evidence','official_decision','edital','cnpj_status','distributor_clearance','tax_clearance','labor_clearance','fgts','other'];
function validFile(bytes,mime){if(mime==='application/pdf')return bytes.subarray(0,5).toString()==='%PDF-';if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(mime.endsWith('spreadsheetml.sheet'))return bytes[0]===80&&bytes[1]===75;return !bytes.includes(0)&&!/<(?:script|iframe|html)\b/i.test(bytes.toString('utf8'));}
export function createApplication({store=createStore(),publicOrigin,coreOrigin,workspace='Expert Energy',coreCall,activityEnabled=false,officialReader,authorDirectoryEnabled=false,mailProvider,mailWebhookSecret,mailAttachmentReader,portalSealer,portalEnabled=process.env.PEE_CLIENT_PORTAL_ENABLED==='true',documentRenderer=renderDocumentPage,demonstrationBuilder}={}){
 const limits=new Map(),evaLimits=new Map(),protection=process.env.PEE_CONTENT_PROTECTION_ENABLED==='true';
 let clientPortal;
 function limit(c,method){
  const now=Date.now(),key=c.tenant+':'+c.subject,minute=Math.floor(now/60000);let counter=limits.get(key);
  if(!counter||counter.minute!==minute){if(limits.size>10000){for(const[k,v]of limits)if(v.minute<minute-2)limits.delete(k);if(limits.size>10000)fail('Aguarde antes de continuar.',429);}counter={minute,reads:0,writes:0};limits.set(key,counter);}
  const field=method==='GET'?'reads':'writes';counter[field]++;if(counter[field]>(field==='reads'?120:30))fail('Limite por minuto atingido. Aguarde para continuar.',429);
 }
 const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
 const list=async(c,kind)=>(await store.rpc(c,'list',{kind})).map(flatten);
 async function get(c,id,kind){if(!uuid(id))fail('Identificador inválido.');const raw=await store.rpc(c,'get',{id});if(kind&&raw.kind!==kind)fail('Registro não encontrado.',404);return flatten(raw);}
 async function related(c,id,kind){return get(c,id,kind);}
 async function snapshot(c,id){if(!uuid(id))fail('Identificador inválido.');const raw=await store.rpc(c,'snapshot',{project_id:id}),p=flatten(raw.project),rows=raw.records.map(r=>({...flatten(r),kind:r.kind}));return {project:p,simulations:rows.filter(r=>r.kind==='simulation'),documents:rows.filter(r=>r.kind==='document'),workflow:rows.filter(r=>r.kind==='workflow'),rule:rows.find(r=>r.kind==='rule'),company:rows.find(r=>r.kind==='company'),unit:rows.find(r=>r.kind==='unit'),workspace:c.workspace??workspace,actor:c.display_name??c.subject,fingerprint:raw.technical_hash,snapshot_hash:raw.snapshot_hash};}

 const mailConfig=mailProvider===undefined?resendConfiguration():null;
 const resolvedMail=mailProvider??(mailConfig?createResendProvider(mailConfig):null);
 clientPortal=createClientPortal({store,sealer:portalSealer,publicOrigin,enabled:portalEnabled,mailProvider:resolvedMail,coreCall});
 async function demoSnapshot(c,id){const data=await snapshot(c,id);data.organization=(await list(c,'company')).find(x=>x.platform_organization===true);return data;}
 const controlledViews=createControlledViews({store,get:related,renderer:documentRenderer});
 const demonstration=createDemonstrationApi({store,snapshot:demoSnapshot,put,get:related,assessment:assessProject,build:demonstrationBuilder,controlledViews});
 const communications=createCommunications({store,snapshot,workspace,publicOrigin,provider:resolvedMail,webhookSecret:mailWebhookSecret??mailConfig?.secret,readAttachment:mailAttachmentReader,controlledViews});
 async function put(c,kind,id,version,payload){const clean={...payload};for(const key of ['id','version','created_by','updated_by','created_at','updated_at'])delete clean[key];return flatten(await store.rpc(c,'put',{kind,id,expected_version:version,payload:clean}));}
 async function auditAuthors(c,s,g,items,names=new Map()){
  if(g.display_name)names.set(c.subject,g.display_name);
  if(c.source==='licensed'){const directory=await workspaceMembers(c,s);for(const m of directory)names.set(m.id,m.name);}
  for(const event of items)if(event.action?.startsWith('portal.')&&typeof event.detail?.client_name==='string'&&!names.has(event.actor_id))names.set(event.actor_id,event.detail.client_name);
  const ids=[...new Set(items.map(e=>e.actor_id))].filter(id=>!names.has(id));
  if(c.source==='core'&&authorDirectoryEnabled){
   if(!coreCall)fail('Diretório do Core indisponível.',503);
   for(let i=0;i<ids.length;i+=40){const result=await coreCall('authors',{organization_id:s.organization,audience:'energyos-pee',token:s.coreToken,author_ids:ids.slice(i,i+40)});if(result.sub!==c.subject||result.tenant_id!==c.tenant)fail('O contexto do autor foi alterado.',403);for(const a of result.author_names)names.set(a.id,a.name);}
  }
  return enrichAudit(items,[...names].map(([id,name])=>({id,name})));
 }
 async function workspaceMembers(c,s){
  if(c.source==='licensed'){const items=[];let after=null;do{const g=await coreCall('licensed_members',{organization_id:s.organization,audience:'energyos-pee',license_id:c.tenant,subject:c.subject,after_id:after});items.push(...g.members.map(m=>({...m,expires_at:g.license.expires_at,monthly_limit:g.monthly_project_limit})));if(!g.has_more)return items;if(!g.next_cursor||g.next_cursor===after||items.length>=500)fail('Consulte a equipe completa na gestão de licenças do Core.',409);after=g.next_cursor;}while(true);}
  if(c.source!=='core'||!coreCall||!authorDirectoryEnabled)fail('A sincronização da equipe com o Core ainda não está disponível.',503);
  const items=[],seen=new Set();let after=null;
  do{const result=await coreCall('members',{organization_id:s.organization,audience:'energyos-pee',token:s.coreToken,after_id:after});if(result.sub!==c.subject||result.tenant_id!==c.tenant)fail('O contexto da equipe foi alterado.',403);for(const m of result.members){if(seen.has(m.id))fail('A equipe foi alterada durante a consulta. Atualize a tela.',409);seen.add(m.id);items.push(m);}if(!result.has_more)return items;if(!result.next_cursor||result.next_cursor===after||items.length>=500)fail('Consulte a gestão completa da equipe no Energy Core.',409);after=result.next_cursor;}while(true);
 }
 function auditFilters(req){const params=new URL(req.url,'http://local.invalid').searchParams,limit=Number(params.get('limit')??25),before=params.get('before'),snapshot=params.get('snapshot');if(![10,25,50,100].includes(limit)||before&&!/^[1-9]\d{0,15}$/.test(before)||snapshot&&!/^\d{1,16}$/.test(snapshot))fail('Paginação inválida.');const date_from=params.get('date_from')||null,date_to=params.get('date_to')||null;for(const value of [date_from,date_to])if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))fail('Período inválido.');if(date_from&&date_to&&date_from>date_to)fail('O início do período deve anteceder o fim.');return {limit,before,snapshot,date_from,date_to};}
 function write(c){if(!['editor','manager','reviewer'].includes(c.role))fail('Seu perfil permite somente consulta.',403);}
 function review(c){if(!['reviewer','manager'].includes(c.role))fail('Revisão exige perfil de revisão técnica ou gestor.',403);}
 async function validate(c,kind,x,old){
  if(!x||typeof x!=='object'||Array.isArray(x))fail('Dados inválidos.');
  if(kind==='company'){if(!validCnpj(x.cnpj))fail('CNPJ inválido. Confira os dígitos verificadores.');return {name:text(x.name,'razão social'),cnpj:x.cnpj.toUpperCase(),representative:text(x.representative,'representante'),email:text(x.email,'e-mail',254),phone:String(x.phone??'').slice(0,50),address:text(x.address,'endereço',1000)};}
  if(kind==='unit'){await related(c,x.company_id,'company');return {company_id:x.company_id,name:text(x.name,'nome da unidade'),uc:text(x.uc,'unidade consumidora',80),address:text(x.address,'endereço',1000),distributor:text(x.distributor,'distribuidora'),tariff:String(x.tariff??'').slice(0,200),annual_mwh:number(x.annual_mwh??0,'consumo anual'),peak_kw:number(x.peak_kw??0,'demanda na ponta')};}
  if(kind==='project'){
   const unit=await related(c,x.unit_id,'unit');if(unit.company_id!==x.company_id)fail('Unidade não pertence à empresa selecionada.');await related(c,x.company_id,'company');
   if(x.typology&&!typologies.includes(x.typology))fail('Tipologia inválida.');
   const sections={};for(const k of Object.keys(requiredSections))sections[k]=String(x.sections?.[k]??'').slice(0,20000);
   if(x.rule_id)await related(c,x.rule_id,'rule');
   let url='';if(x.call_url){const u=new URL(x.call_url);if(u.protocol!=='https:'||u.username||u.password)fail('Informe o link HTTPS oficial do edital.');url=u.href;}
   const e=x.economics??{},economics={energy_cost:number(e.energy_cost??0,'custo evitado de energia'),demand_cost:number(e.demand_cost??0,'custo evitado de demanda'),discount_rate:number(e.discount_rate??8,'taxa de desconto',0,100),shared_cost:number(e.shared_cost??0,'custos compartilhados'),shared_life:number(e.shared_life??10,'vida útil dos custos compartilhados',1,60),coincidence_confirmed:e.coincidence_confirmed===true};
   const responsibility={};for(const k of ['elaborator_name','engineer_name','registration','art_number'])responsibility[k]=String(x.responsibility?.[k]??old?.responsibility?.[k]??'').slice(0,300);
   const answers={};for(const [k,v]of Object.entries(x.requirement_answers??{})){if(!uuid(k))fail('Exigência inválida.');answers[k]={answer:String(v?.answer??'').slice(0,10000)};}
   return {...(old??{}),name:text(x.name,'nome do projeto'),typology:x.typology??old?.typology??'',company_id:x.company_id,unit_id:x.unit_id,distributor:unit.distributor,call_name:String(x.call_name??'').slice(0,300),call_url:url,rule_id:x.rule_id||null,sections,responsibility,economics,requirement_answers:answers,phase:old?.phase??'Elaboração'};
  }
  if(kind==='simulation'){await related(c,x.project_id,'project');const s=validateSimulation(x);const all=await list(c,'simulation');if(s.selected&&all.some(a=>a.id!==old?.id&&a.project_id===s.project_id&&a.selected&&a.boundary.toLocaleLowerCase('pt-BR')===s.boundary.toLocaleLowerCase('pt-BR')))fail('Já existe medida selecionada nesta fronteira.');return s;}
  if(kind==='rule'){
   if(x.reviewed===true)review(c);const u=new URL(x.source_url);if(u.protocol!=='https:'||u.username||u.password)fail('Fonte do edital inválida.');
   if(!Array.isArray(x.requirements)||x.requirements.length>200)fail('Lista de exigências inválida.');
   const qualification={};for(const id of ['cnpj_status','distributor_clearance','tax_clearance','labor_clearance','fgts'])qualification[id]=typeof x.qualification?.[id]==='boolean'?x.qualification[id]:null;
   if(x.criteria!=null&&!Array.isArray(x.criteria))fail('Lista de critérios inválida.');
   const criteria=(x.criteria??[]).map(r=>{const formula=r.formula??'manual';if(!Object.hasOwn(scoringMethods,formula)||formula!=='manual'&&!Object.hasOwn(scoringMetrics,r.metric))fail('Método ou métrica de pontuação inválido.');if(formula==='share'&&!['equipment_share','counterpart_share','training_share'].includes(r.metric))fail('Participação direta exige métrica percentual do orçamento.');if(formula==='relative_high'&&['rcb_total','rcb_pee'].includes(r.metric))fail('A menor RCB é favorecida; confira a metodologia inversa do edital.');let referenceSource=null;if(r.reference_source){const ref=new URL(r.reference_source);if(ref.protocol!=='https:'||ref.username||ref.password)fail('Fonte de referência inválida.');referenceSource=ref.href;}return {id:text(r.id,'identificador do critério',30),label:text(r.label,'critério',500),weight:number(r.weight,'peso',0,100),maximum:number(r.maximum??100,'pontuação máxima',0.001,1e9),source:text(r.source,'cláusula de pontuação',1000),method:text(r.method??'Parecer técnico conforme edital','metodologia',3000),formula,metric:formula==='manual'?null:r.metric,reference_value:r.reference_value==null?null:number(r.reference_value,'referência da concorrência',0,1e12),reference_source:referenceSource,reference_call:String(r.reference_call??'').slice(0,300),reference_typology:typologies.includes(r.reference_typology)?r.reference_typology:null};});

   if(criteria.length>100||new Set(criteria.map(r=>r.id)).size!==criteria.length)fail('Critérios duplicados ou quantidade excessiva.');
   if(x.reviewed===true&&criteria.length&&Math.abs(criteria.reduce((s,r)=>s+r.weight,0)-100)>0.000001)fail('Os pesos do edital devem totalizar 100 pontos.');
   const deadline=x.deadline?String(x.deadline):null;if(deadline&&(!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||!Number.isFinite(Date.parse(deadline))))fail('Prazo inválido.');
   let attachment=null;if(x.document_id){attachment=await related(c,x.document_id,'document');if(attachment.category!=='edital')fail('Selecione o anexo original do edital.');}
   if(x.rcb_basis!=null&&!['pee','total'].includes(x.rcb_basis))fail('Base de custos da RCB inválida.');
   const allowedTypologies=x.allowed_typologies??[];if(!Array.isArray(allowedTypologies)||allowedTypologies.some(t=>!typologies.includes(t)))fail('Tipologias do edital inválidas.');
   const allowedTypes=x.allowed_types??[];if(!Array.isArray(allowedTypes)||allowedTypes.some(t=>!Object.hasOwn(types,t)))fail('Usos finais do edital inválidos.');
   const profile={name:text(x.name,'nome do edital'),distributor:text(x.distributor,'distribuidora'),edition:text(x.edition,'versão do edital',100),source_url:u.href,document_id:attachment?.id??null,source_hash:attachment?.sha256??null,deadline,qualification,criteria,rcb_basis:x.rcb_basis??null,allowed_typologies:allowedTypologies,allowed_types:allowedTypes,minimum_annual_mwh:x.minimum_annual_mwh==null?null:number(x.minimum_annual_mwh,'consumo mínimo'),minimum_peak_kw:x.minimum_peak_kw==null?null:number(x.minimum_peak_kw,'demanda mínima'),reviewed:x.reviewed===true,max_rcb:x.max_rcb==null?null:number(x.max_rcb,'RCB máxima',0.001,100),requirements:x.requirements.map(r=>({id:uuid(r.id)?r.id:randomUUID(),label:text(r.label,'exigência',2000),document_required:r.document_required===true})),reviewed_by:x.reviewed===true?c.subject:null,reviewed_at:x.reviewed===true?new Date().toISOString():null};
   return {...profile,evaluation_contact:preserveEvaluationContact(old,profile)};
  }
  fail('Use a operação específica deste módulo.',403);
 }
 return {mailEnabled:communications.enabled,archiveMail:communications.archive,async handle(req,res,path,authorize){
  if(await clientPortal.publicHandle(req,res,path,{jsonBody,send}))return true;
  if(path==='/webhooks/resend'&&req.method==='POST'){await communications.webhook(req,res);return true;}
  if(req.method==='GET'&&path==='/commercial'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; media-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");res.end(await readFile(new URL('web/commercial.html',import.meta.url)));return true;
  }
  if(req.method==='GET'&&path==='/assets/comercial.mp4'){
   const file=new URL('web/comercial.mp4',import.meta.url),size=(await stat(file)).size;res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
   if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return true;}
    const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;if(start>=size||start>end){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return true;}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});createReadStream(file,{start,end}).pipe(res);return true;
   }res.setHeader('Content-Length',size);createReadStream(file).pipe(res);return true;
  }
  if(req.method==='GET'&&path.startsWith('/assets/')){
   const assets={'/assets/controlled-view.mjs':['application/javascript; charset=utf-8','web/controlled-view.mjs'],'/assets/workspace-demonstration.mjs':['application/javascript; charset=utf-8','web/workspace-demonstration.mjs'],'/assets/check-resolution.mjs':['application/javascript; charset=utf-8','web/check-resolution.mjs'],'/assets/workspace-templates.mjs':['application/javascript; charset=utf-8','web/workspace-templates.mjs'],'/assets/content-protection.mjs':['application/javascript; charset=utf-8','web/content-protection.mjs'],'/assets/workspace-client-portal.mjs':['application/javascript; charset=utf-8','web/workspace-client-portal.mjs'],'/assets/workspace-portfolio.mjs':['application/javascript; charset=utf-8','web/workspace-portfolio.mjs'],'/assets/workspace-commercial.mjs':['application/javascript; charset=utf-8','web/workspace-commercial.mjs'],'/assets/workspace-distributors.mjs':['application/javascript; charset=utf-8','web/workspace-distributors.mjs'],'/assets/workspace-signatures.mjs':['application/javascript; charset=utf-8','web/workspace-signatures.mjs'],'/assets/certificate-signer.mjs':['application/javascript; charset=utf-8','web/certificate-signer.mjs'],'/assets/workspace-communications.mjs':['application/javascript; charset=utf-8','web/workspace-communications.mjs'],'/assets/workspace-progress.mjs':['application/javascript; charset=utf-8','web/workspace-progress.mjs'],'/assets/app.js':['application/javascript; charset=utf-8','web/app.js'],'/assets/activity.mjs':['application/javascript; charset=utf-8','web/activity.mjs'],'/assets/workspace-modules.mjs':['application/javascript; charset=utf-8','web/workspace-modules.mjs'],'/assets/workspace-admin.mjs':['application/javascript; charset=utf-8','web/workspace-admin.mjs'],'/assets/workspace-audit.mjs':['application/javascript; charset=utf-8','web/workspace-audit.mjs'],'/assets/workspace-team.mjs':['application/javascript; charset=utf-8','web/workspace-team.mjs'],'/assets/app.css':['text/css; charset=utf-8','web/app.css'],'/assets/logo.png':['image/png','web/logo.png'],'/assets/favicon.ico':['image/x-icon','web/favicon.ico'],'/assets/comercial.vtt':['text/vtt; charset=utf-8','web/comercial.vtt'],'/assets/comercial-poster.jpg':['image/jpeg','web/comercial-poster.jpg']};
   const match=assets[path]??({'/assets/fonts.css':['text/css; charset=utf-8','web/fonts.css'],'/assets/brand.css':['text/css; charset=utf-8','web/brand.css'],'/assets/energyos-icon.svg':['image/svg+xml','web/energyos-icon.svg']}[path])??(/^\/assets\/font-[a-f0-9]{12}\.ttf$/.test(path)?['font/ttf','web/'+path.split('/').at(-1)]:null);if(!match)return false;res.setHeader('Content-Type',match[0]);res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:");res.end(await readFile(new URL(match[1],import.meta.url)));return true;
  }
  if(path!=='/app'&&!path.startsWith('/api/app/'))return false;
  const {session:s,grant:g}=await authorize(req);const c={source:s.source==='licensed'?'licensed':'core',tenant:s.tenant,subject:s.subject,role:g.role,monthly_limit:g.monthly_project_limit,display_name:g.display_name??null,workspace:g.workspace_name??workspace};
  limit(c,req.method);
  if(req.method==='GET'&&path==='/app'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self' wss://127.0.0.1:65156; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");res.end(await readFile(new URL('web/index.html',import.meta.url)));return true;
  }
  if(req.method!=='GET'){if(req.headers.origin!==publicOrigin||req.headers['x-csrf-token']!==s.csrf)fail('Confirme novamente seu acesso para continuar.',403);}
  if(await clientPortal.workspaceHandle(req,res,path,c,{jsonBody,send,get:related}))return true;
  if(await controlledViews.handle(req,res,path,c,{send}))return true;
  if(await communications.handle(req,res,path,c,g,{jsonBody,send,reauthorize:()=>authorize(req)}))return true;
  if(await demonstration.handle(req,res,path,c,{jsonBody,send,reauthorize:()=>authorize(req)}))return true;
  if(path==='/api/app/templates/organization'){
   if(c.role==='finance')fail('Seu perfil não permite consultar modelos técnicos.',403);
   const old=(await list(c,'company')).find(x=>x.platform_organization===true);
   if(req.method==='GET'){send(res,200,old??{name:c.workspace});return true;}
   if(req.method!=='POST')fail('Operação inválida.',405);write(c);if(c.role==='reviewer')fail('Cadastro da organização exige elaboração.',403);
   const body=await jsonBody(req,10000),payload=await validate(c,'company',body,old);if((old?.version??0)!==(body.version??0))fail('O cadastro mudou. Atualize antes de salvar.',409);
   const h=digest(Buffer.from(c.tenant+':template-organization')),id=old?.id??(h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32));send(res,200,await put(c,'company',id,body.version??0,{...payload,platform_organization:true}));return true;
  }
  if(req.method==='GET'&&path==='/api/app/templates'){if(c.role==='finance')fail('Seu perfil não permite consultar modelos técnicos.',403);send(res,200,{items:templateCatalog,official_resources:officialTemplateResources});return true;}
  const templateRoute=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/templates\/([a-z_]+)(?:\/(generate))?$/);
  if(templateRoute){
   if(c.role==='finance')fail('Seu perfil não permite consultar modelos técnicos.',403);
   if(!['GET','POST'].includes(req.method)||req.method==='GET'&&templateRoute[3]||req.method==='POST'&&!templateRoute[3])fail('Operação de modelo inválida.',405);
   const data=await snapshot(c,templateRoute[1]);data.organization=(await list(c,'company')).find(x=>x.platform_organization===true);const baseHash=data.snapshot_hash;data.snapshot_hash=digest(Buffer.from(baseHash+'\n'+JSON.stringify(data.organization??null)));const model=renderTemplate(data,templateRoute[2]);
   if(req.method==='GET'){send(res,200,{...templateBinding(data,templateRoute[2]),model_hash:model.model_hash,reference:model.reference});return true;}
   write(c);const body=await jsonBody(req,3000);if(!model.template.formats.includes(body.format))fail('Formato incompatível com este modelo.');
   if(body.snapshot_hash!==data.snapshot_hash||body.model_hash!==model.model_hash)fail('Os dados mudaram. Confira novamente o modelo antes de gerar.',409);
   if(body.attach===true&&c.role==='reviewer')fail('O perfil de elaboração é necessário para anexar modelos.',403);
   const documentData={...data,emission_reference:model.reference},mime=body.format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf',bytes=body.format==='xlsx'?renderProjectWorkbook(documentData,{formulaModel:true}):await renderBrandedPdf(documentData,model.html,model.template.title,model.template.id),hash=digest(bytes),name=model.reference+'.'+body.format;
   const fresh=await authorize(req),organization=(await list(c,'company')).find(x=>x.platform_organization===true);if(fresh.grant.role!==c.role||(await snapshot(c,data.project.id)).snapshot_hash!==baseHash||JSON.stringify(organization??null)!==JSON.stringify(data.organization??null))fail('A permissão ou os dados mudaram. Atualize antes de gerar.',409);
   if(body.attach===true){const id=randomUUID(),key=c.tenant+'/'+id+'/'+hash;await store.upload(key,bytes,mime);const record=await put(c,'document',id,0,{name,project_id:data.project.id,simulation_id:null,category:model.template.category,mime,size:bytes.length,sha256:hash,storage_key:key,signature_method:null,signature_review:'pending',signature_evidence_id:null,issuer:'EnergyOS PEE — modelo não assinado',reference:model.reference,template_id:model.template.id,template_version:model.template.version,template_hash:model.model_hash,source_snapshot:data.snapshot_hash,source_project_version:data.project.version,demonstration:model.demonstration,model_document:true});send(res,201,{document:record,validation:model.missing,status:model.status});return true;}
   if(body.preview===true){send(res,200,controlledViews.register(c,{bytes,mime,name,project_id:data.project.id}));return true;}
   if(protection)fail('Consulte este modelo em tela ou envie pelo ambiente Comunicações à banca cadastrada.',403);
   res.setHeader('Content-Type',mime);res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(bytes);return true;
  }
  if(req.method==='GET'&&path==='/api/app/bootstrap'){
   const data=Object.fromEntries(await Promise.all(kinds.map(async k=>[k,c.role==='finance'&&k!=='royalty'?[]:await list(c,k)]))),usage=await store.rpc(c,'usage',{monthly_limit:c.monthly_limit});send(res,200,{identity:{email:g.email??null,content_protection_enabled:protection,network_address:protection?networkAddress(req):null,workspace:c.workspace,role:c.role,subject:c.subject,display_name:g.display_name??null,monthly_limit:c.monthly_limit,csrf:s.csrf,expires_at:g.expires_at,core_url:coreOrigin+'/pee',source:c.source,activity_enabled:activityEnabled,idle_seconds:900},usage,distributors:distributors.map(({hosts,...d})=>d),official_sources:officialSources.map(({hosts,pathPrefix,...s})=>s),assistance_fields:Object.fromEntries(Object.entries(assistanceFields).map(([id,f])=>[id,f.label])),guide:guideReference,selection_criteria:selectionCriteria,scoring_metrics:scoringMetrics,scoring_methods:scoringMethods,typologies,types,inputs:opportunityInputs,reports:reportTypes,sections:requiredSections,data});return true;
  }
  if(req.method==='POST'&&path==='/api/app/security/events'){if(!protection)fail('Recurso não habilitado.',404);const b=await jsonBody(req,1500);if(!['window_hidden','copy_command_blocked','print_command_blocked'].includes(b.event))fail('Evento inválido.');await store.security(c,b.event,{reported_by_browser:true,display_name:c.display_name,network_address:networkAddress(req)});send(res,200,{recorded:true});return true;}
  if(req.method==='GET'&&path==='/api/app/portfolio'){
   if(c.role==='finance')fail('Seu perfil não permite consultar projetos.',403);
   const after=new URL(req.url,'http://local.invalid').searchParams.get('after');if(after&&!uuid(after))fail('Paginação inválida.');
   const projects=(await list(c,'project')).sort((a,b)=>a.id.localeCompare(b.id)),page=projects.filter(p=>!after||p.id>after).slice(0,20),items=[];
   for(let i=0;i<page.length;i+=4){items.push(...await Promise.all(page.slice(i,i+4).map(async p=>portfolioRow(await snapshot(c,p.id)))));}
   const last=page.at(-1)?.id??null;send(res,200,{items,total:projects.length,next_cursor:last&&projects.some(p=>p.id>last)?last:null,calculated_at:new Date().toISOString()});return true;
  }
  if(req.method==='POST'&&['/api/app/eva/analyze','/api/app/eva/status'].includes(path)){
   if(process.env.PEE_EVA_AI_ENABLED!=='true')fail('A assistência EVA ainda não foi habilitada.',503);
   const body=await jsonBody(req,6000),auth={organization_id:s.organization,audience:'energyos-pee',source:c.source,...(c.source==='core'?{token:s.coreToken}:{license_id:c.tenant,subject:c.subject})};
   if(path.endsWith('/status')){if(!uuid(body.job_id))fail('Consulta EVA inválida.');send(res,200,await coreCall('eva_status',{...auth,job_id:body.job_id}));return true;}
   let result;try{result=await assistFromOfficialSources(body,{...(officialReader?{reader:officialReader}:{})});}catch{fail('Confira o campo PEE e as fontes oficiais.');}const sources=result.sources.filter(x=>x.status==='excerpt').map(({source_id,url,excerpt,sha256})=>({source_id,url,excerpt,sha256}));if(!sources.length)fail('Nenhuma evidência oficial disponível. Confira as fontes antes de pedir análise.',422);
   send(res,200,{...await coreCall('eva_start',{...auth,field:body.field,question:body.question??'',sources}),sources:result.sources,label:result.label});return true;
  }
  if(req.method==='POST'&&path==='/api/app/eva'){
   const key=c.tenant+':'+c.subject,minute=Math.floor(Date.now()/60000);for(const[k,v]of evaLimits)if(v.minute<minute)evaLimits.delete(k);let entry=evaLimits.get(key);if(!entry){entry={minute,count:0};evaLimits.set(key,entry);}if(++entry.count>3)fail('A EVA permite até 3 consultas por minuto. Aguarde para continuar.',429);
   const body=await jsonBody(req,6000);let result;try{result=await assistFromOfficialSources(body,{...(officialReader?{reader:officialReader}:{})});}catch{fail('Escolha um campo PEE e até três fontes da lista oficial. A EVA atende apenas ao preenchimento nesta plataforma.');}send(res,200,result);return true;
  }
  if(req.method==='GET'&&path==='/api/app/audit'){const page=await store.rpc(c,'audit_page',auditFilters(req));page.items=await auditAuthors(c,s,g,page.items);send(res,200,page);return true;}
  if(req.method==='GET'&&path==='/api/app/audit/export'){
   const query=new URL(req.url,'http://local.invalid').searchParams,format=query.get('format')??'json';if(!['json','csv'].includes(format))fail('Formato de exportação inválido.');const filters={...auditFilters(req),limit:500,before:null,snapshot:null},items=[],names=new Map();let page;
   do{await authorize(req);page=await store.rpc(c,'audit_page',filters);if(page.total>25000)fail('A trilha excede 25.000 eventos. Selecione um período menor para exportar a trilha completa do período.');filters.snapshot=page.snapshot;items.push(...await auditAuthors(c,s,g,page.items,names));filters.before=page.next_cursor;}while(page.has_more);
   const at=new Date().toISOString();res.setHeader('Content-Disposition','attachment; filename="EnergyOS-PEE-trilha-'+at.slice(0,10)+'.'+format+'"');res.setHeader('Content-Type',format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8');
   const exported={platform:'EnergyOS – PEE',workspace:c.workspace,exported_at:at,exported_by:g.display_name??null,exported_by_id:c.subject,filters:{date_from:filters.date_from,date_to:filters.date_to},snapshot:page.snapshot,total:items.length,events:items};res.end(format==='csv'?'\uFEFF'+auditCsv(items):JSON.stringify(exported,null,2));return true;
  }
  if(req.method==='POST'&&path==='/api/app/license/cancel'){
   if(c.source!=='licensed'||c.role!=='manager')fail('O cancelamento exige gestor da organização licenciada.',403);const b=await jsonBody(req,5000);if(b.confirm!==true||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>2000)fail('Informe o motivo e confirme o pedido.');const g=await coreCall('licensed_cancel',{organization_id:s.organization,audience:'energyos-pee',license_id:c.tenant,subject:c.subject,reason:b.reason,confirm:true});await store.syncLicense(g);send(res,200,{license_id:c.tenant,requested_at:g.license.cancellation_requested_at,effective_at:g.license.cancellation_effective_at,automatic_renewal:false,outstanding_royalties_preserved:true});return true;
  }
  if(req.method==='GET'&&path==='/api/app/licensed-status'){send(res,200,c.source==='licensed'?await store.licensedStatus(c):{internal:true,usage:await store.rpc(c,'usage',{monthly_limit:c.monthly_limit})});return true;}
  if(req.method==='POST'&&path==='/api/app/royalties'){
   if(c.source!=='licensed'||!['manager','reviewer'].includes(c.role))fail('A apuração exige licença contratada e perfil de revisão ou gestão.',403);
   const b=await jsonBody(req,20000);let row;
   if(b.retry_id){if(!uuid(b.retry_id))fail('Apuração inválida.');row=await related(c,b.retry_id,'royalty');}
   else{
    const n=b.notice,keys=['event_id','license_id','project_reference','emission_reference','contract_hash','contract_version','decision_reference','decision_date','decision_sha256','distributor','approved_pee_cents','kind','previous_event_id','reason'];
    if(!n||Object.keys(n).length!==keys.length||keys.some(k=>!Object.hasOwn(n,k))||!uuid(n.event_id)||n.license_id!==c.tenant||!uuid(n.project_reference)||!uuid(n.emission_reference)||!/^[a-f0-9]{64}$/.test(n.contract_hash)||!/^[a-f0-9]{64}$/.test(n.decision_sha256)||!Number.isInteger(n.contract_version)||n.contract_version<1||!Number.isSafeInteger(n.approved_pee_cents)||n.approved_pee_cents<0||n.approved_pee_cents>1e12||!['approval','adjustment','cancellation'].includes(n.kind)||n.previous_event_id!==null&&!uuid(n.previous_event_id)||!/^\d{4}-\d{2}-\d{2}$/.test(n.decision_date)||!Number.isFinite(Date.parse(n.decision_date))||new Date(n.decision_date+'T00:00:00Z').toISOString().slice(0,10)!==n.decision_date||typeof n.reason!=='string'||n.reason.trim().length<10||n.reason.length>2000||typeof n.decision_reference!=='string'||!n.decision_reference.trim()||n.decision_reference.length>300)fail('Confira os campos da apuração e a decisão oficial.');
    const data=await snapshot(c,n.project_reference);if(n.distributor!==data.project.distributor)fail('Distribuidora divergente do projeto.');if(n.kind==='cancellation'&&n.approved_pee_cents!==0)fail('Cancelamento exige base zero.');
    row=flatten(await store.royalty(c,'prepare',{notice:n}));
   }
   const g=await coreCall('licensed_royalty',{organization_id:s.organization,audience:'energyos-pee',license_id:c.tenant,subject:c.subject,notice:row.notice});const saved=await store.royalty(c,'confirm',{id:row.id,receipt:g.royalty});send(res,200,flatten(saved));return true;
  }
  if(req.method==='GET'&&path==='/api/app/license'){send(res,200,await store.rpc(c,'usage',{monthly_limit:c.monthly_limit}));return true;}
  if(req.method==='GET'&&path==='/api/app/team'){send(res,200,{members:await workspaceMembers(c,s),management_url:coreOrigin+'/pee',grant_management:'energy_core'});return true;}
  const detail=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/details$/);
  if(detail&&req.method==='POST'){
   write(c);if(c.role==='reviewer')fail('O perfil de revisão não altera o levantamento técnico.',403);
   const p=await related(c,detail[1],'project'),body=await jsonBody(req,7000000),version=number(body.version,'versão',1),kind=body.kind;let patch;
   if(kind==='responsibilities'){
    const members=await workspaceMembers(c,s),responsibility={...(p.responsibility??{})};
    for(const key of ['project_owner','elaborator','reviewer']){const id=body.value?.[key+'_user_id']||null;if(id&&!uuid(id))fail('Responsável inválido.');const person=id?members.find(m=>m.id===id&&m.active):null;if(id&&(!person||!(key==='reviewer'?['reviewer']:['editor']).includes(person.role)))fail('Escolha um usuário ativo com o perfil adequado no Core.');responsibility[key+'_user_id']=person?.id??null;responsibility[key+'_user_name']=person?.name??null;}
    send(res,200,await put(c,'project',p.id,version,{...p,responsibility}));return true;
   }
   if(kind==='mv')patch={mv_plan:validateMv(body.value),mv_review:null};
   else if(kind==='resources')patch={resources:validateResources(body.value)};
   else if(kind==='schedule')patch={schedule:validateSchedule(body.value)};
   else if(kind==='diagnosis'){
    const doc=await related(c,body.document_id,'document');if(doc.project_id!==p.id||doc.mime!=='text/csv'||!doc.storage_key.startsWith(c.tenant+'/'))fail('Selecione o CSV de medições anexado a este projeto.');
    const bytes=Buffer.from(await(await store.download(doc.storage_key)).arrayBuffer());if(digest(bytes)!==doc.sha256||bytes.length>5000000)fail('CSV inválido ou integridade não confirmada.');
    patch={diagnosis:{...parseLoadCurve(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),document_id:doc.id,sha256:doc.sha256,imported_at:new Date().toISOString(),actor:c.subject}};
   }else if(kind==='score'){
    const rule=await related(c,p.rule_id,'rule');patch={scoring:{...scoreProject(rule.criteria,body.value),rule_id:rule.id,rule_version:rule.version,answers:body.value,at:new Date().toISOString()}};
   }else fail('Detalhamento não reconhecido.');
   send(res,200,await put(c,'project',p.id,version,{...p,...patch}));return true;
  }
  const mvReview=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/mv-review$/);
  if(mvReview&&req.method==='POST'){
   review(c);const data=await snapshot(c,mvReview[1]),p=data.project,body=await jsonBody(req),issues=mvIssues(p.mv_plan);if(issues.length)fail('Complete o plano de M&V: '+issues.join('; '));
   const doc=await related(c,body.document_id,'document');if(doc.project_id!==p.id||doc.category!=='mv_plan'||doc.signature_review!=='verified'||body.confirm!==true)fail('Vincule o plano de M&V assinado e confirme a revisão.');
   send(res,200,await put(c,'project',p.id,number(body.version,'versão',1),{...p,mv_review:{input_hash:data.fingerprint,actor:c.subject,at:new Date().toISOString(),document_id:doc.id,note:text(body.note,'parecer de revisão',5000)}}));return true;
  }
  const scoreReview=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/score-review$/);
  if(scoreReview&&req.method==='POST'){
   review(c);const data=await snapshot(c,scoreReview[1]),p=data.project,body=await jsonBody(req),criteria=data.rule?.criteria;
   if(!data.rule?.reviewed||!criteria?.length||Math.abs(criteria.reduce((s,r)=>s+r.weight,0)-100)>0.000001)fail('Revise os pesos e o método de pontuação do edital.');
   const assessments={};for(const criterion of criteria){const input=body.assessments?.[criterion.id];if(!input)continue;const doc=await related(c,input.evidence_id,'document');if(doc.project_id!==p.id||doc.signature_review!=='verified'||doc.expires_on&&doc.expires_on<new Date().toISOString().slice(0,10))fail('Vincule uma evidência válida, assinada e conferida para '+criterion.label);
    assessments[criterion.id]={value:number(input.value,'nota de '+criterion.label,0,criterion.maximum),evidence_id:doc.id,evidence_hash:doc.sha256,note:text(input.note,'justificativa e memória de pontuação',5000),reviewed:true,reviewer:c.subject};
   }
   if(!Object.keys(assessments).length)fail('Informe ao menos um critério com evidência.');
   send(res,200,await put(c,'project',p.id,number(body.version,'versão',1),{...p,scoring:{rule_id:data.rule.id,rule_version:data.rule.version,input_hash:data.fingerprint,assessments,at:new Date().toISOString(),reviewer:c.subject}}));return true;
  }
  const qualityReview=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/quality-review$/);
  if(qualityReview&&req.method==='POST'){
   review(c);const data=await snapshot(c,qualityReview[1]),p=data.project,body=await jsonBody(req),domain=body.domain;
   if(typeof body.note!=='string'||body.note.trim().length<20)fail('Registre um parecer técnico detalhado.');
   if(!['technical','budget','concession','schedule'].includes(domain)||body.confirm!==true)fail('Confirme o domínio da revisão.');
   const doc=await related(c,body.document_id,'document');if(doc.project_id!==p.id||doc.signature_review!=='verified')fail('Vincule a evidência assinada e conferida desta revisão.');
   if(domain==='technical'&&Object.keys(requiredSections).some(k=>!p.sections?.[k]?.trim()))fail('Complete todas as seções técnicas antes da revisão.');
   if(domain==='budget'&&(!p.resources?.length||p.resources.some(r=>!r.quotation||!r.eligibility_clause)))fail('Complete recursos, cotações e cláusulas de admissibilidade.');
   if(domain==='schedule'&&!p.schedule?.length)fail('Cadastre o cronograma com datas e responsáveis.');
   if(domain==='concession'&&doc.category!=='bills')fail('A comprovação da concessão exige fatura da unidade.');
   const record={input_hash:data.fingerprint,actor:c.subject,document_id:doc.id,document_hash:doc.sha256,note:text(body.note,'parecer responsável',5000),at:new Date().toISOString()};
   send(res,200,await put(c,'project',p.id,number(body.version,'versão',1),{...p,reviewed_domains:{...(p.reviewed_domains??{}),[domain]:record}}));return true;
  }
  const actionAssignment=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/action-assignment$/);
  if(actionAssignment&&req.method==='POST'){
   write(c);if(c.role==='reviewer')fail('Atribuições são geridas pelo elaborador ou gestor.',403);const data=await snapshot(c,actionAssignment[1]),p=data.project,body=await jsonBody(req),q=evaluateProject(data);
   if(!q.checks.some(c=>c.id===body.check_id))fail('Item do checklist não encontrado.');const due=String(body.due_on??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due)))fail('Defina uma data válida.');
   send(res,200,await put(c,'project',p.id,number(body.version,'versão',1),{...p,action_assignments:{...(p.action_assignments??{}),[body.check_id]:{responsible:text(body.responsible,'responsável pela ação'),due_on:due,note:String(body.note??'').slice(0,3000),assigned_by:c.subject,at:new Date().toISOString()}}}));return true;
  }
  const record=path.match(/^\/api\/app\/records\/(company|unit|project|simulation|rule)(?:\/([a-f0-9-]{36}))?$/);
  if(record&&req.method==='POST'){
   write(c);const body=await jsonBody(req),id=record[2]??randomUUID(),version=record[2]?number(body.version,'versão',1,1e9):0,old=record[2]?await get(c,id,record[1]):null;
   if(record[1]==='project'&&c.role==='reviewer')fail('Seu perfil de revisão não altera o projeto técnico.',403);
   const payload=await validate(c,record[1],body,old);send(res,record[2]?200:201,await put(c,record[1],id,version,payload));return true;
  }
  const contactRoute=path.match(/^\/api\/app\/rules\/([a-f0-9-]{36})\/evaluation-contact$/);
  if(contactRoute&&req.method==='POST'){
   write(c);const b=await jsonBody(req),rule=await related(c,contactRoute[1],'rule');if(!Number.isInteger(b.version)||b.version<1)fail('Versão do edital inválida.');
   const contact=evaluationContact(b.contact,{rule,actor:c.subject,role:c.role});send(res,200,await put(c,'rule',rule.id,b.version,{...rule,evaluation_contact:contact}));return true;
  }
  const analysis=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/analysis$/);
  if(analysis&&req.method==='GET'){const data=await snapshot(c,analysis[1]);if(data.project.demonstration)data.organization=(await list(c,'company')).find(x=>x.platform_organization===true);const assessment=assessProject(data);send(res,200,{...assessment,progress:integratedProgress(data,assessment),demonstration:demonstrationPresentation(data,assessment)});return true;}
  const packageRoute=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/package$/);
  if(packageRoute&&req.method==='POST'){
   write(c);if(protection)fail('Exportação de pacotes indisponível. Consulte os documentos em tela e utilize Comunicações para o envio controlado.',403);const body=await jsonBody(req);if(!uuid(body.request_id))fail('Identificador de emissão obrigatório.');if(!['review','presentation'].includes(body.mode))fail('Escolha pacote de revisão ou de apresentação.');const data=await snapshot(c,packageRoute[1]);if(protection&&data.documents.some(d=>isProtectedDocument(d,data.documents)))fail('O conjunto contém arquivos protegidos. Utilize o envio controlado à distribuidora.',403);const bundle=await prepareProjectPackage({...data,emission_reference:body.mode==='presentation'?body.request_id:null},{download:key=>store.download(key),mode:body.mode});const fresh=await authorize(req);if(fresh.grant.role!==c.role)fail('Sua permissão mudou. Reabra o projeto.',403);
   if(body.mode==='presentation')await store.rpc(c,'emit',{id:body.request_id,project_id:data.project.id,document_hash:bundle.sha256,snapshot_hash:data.snapshot_hash,monthly_limit:c.monthly_limit});else if((await snapshot(c,data.project.id)).snapshot_hash!==data.snapshot_hash)fail('O projeto mudou durante a preparação. Atualize antes de baixar.',409);
   res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition','attachment; filename="EnergyOS-PEE-'+data.project.id+'-'+body.mode+'.zip"');res.setHeader('X-Document-SHA256',bundle.sha256);res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(bundle.bytes);return true;
  }
  const report=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/reports\/(final|presentation|diagnosis|memorial|mv|economics|schedule|documents|compliance|progress)$/);
  if(report&&req.method==='POST'){
   write(c);const body=await jsonBody(req);const format=body.format??'html';if(!['html','pdf','xlsx'].includes(format))fail('Formato de relatório inválido.');if(format==='xlsx'&&report[2]!=='final')fail('A planilha reúne o projeto completo.');const data=await snapshot(c,report[1]),documentData={...data,emission_reference:report[2]==='final'?body.request_id:null},html=renderReport(documentData,report[2]),bytes=format==='pdf'?await renderProjectPdf(documentData,report[2]):format==='xlsx'?renderProjectWorkbook(documentData):Buffer.from(html),hash=digest(bytes);const fresh=await authorize(req);if(fresh.grant.role!==c.role)fail('Sua permissão mudou. Reabra o projeto.',403);
   if(body.preview===true){send(res,200,controlledViews.register(c,{bytes,mime:format==='pdf'?'application/pdf':format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/html',name:reportTypes[report[2]],project_id:data.project.id}));return true;}
   if(protection)fail('Relatórios são consultados em tela. Encaminhe o documento pela área Comunicações.',403);
   if(report[2]==='final'){if(!uuid(body.request_id))fail('Identificador de emissão obrigatório.');await store.rpc(c,'emit',{id:body.request_id,project_id:report[1],document_hash:hash,snapshot_hash:data.snapshot_hash,monthly_limit:c.monthly_limit});}
   res.setHeader('Content-Type',format==='pdf'?'application/pdf':format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/html; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="EnergyOS-PEE-${report[1]}-${report[2]}.${format}"`);res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox");res.setHeader('X-Document-SHA256',hash);res.end(bytes);return true;
  }
  if(path==='/api/app/documents'&&req.method==='POST'){
   write(c);if(c.role==='reviewer')fail('A revisão não inclui upload de documentos do elaborador.',403);
   const body=await jsonBody(req,29000000);await related(c,body.project_id,'project');if(body.simulation_id){const sim=await related(c,body.simulation_id,'simulation');if(sim.project_id!==body.project_id)fail('Medida pertence a outro projeto.');}
   if(!categories.includes(body.category)||!mimeTypes.includes(body.mime)||typeof body.content_base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.content_base64))fail('Tipo de documento inválido.');
   if(body.category==='manufacturer_manual'&&!body.simulation_id)fail('Vincule o manual à medida e ao equipamento correspondente.');
   const issued=body.issued_on||null,expires=body.expires_on||null;for(const date of [issued,expires])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))))fail('Data do documento inválida.');if(issued&&expires&&issued>expires)fail('Validade anterior à emissão do documento.');
   const bytes=Buffer.from(body.content_base64,'base64');if(!bytes.length||bytes.length>20971520||!validFile(bytes,body.mime))fail('Arquivo inválido ou acima de 20 MB.');
   const id=randomUUID(),hash=digest(bytes),key=c.tenant+'/'+id+'/'+hash;await store.upload(key,bytes,body.mime);
   const payload={name:text(body.name,'nome do arquivo',200),project_id:body.project_id,simulation_id:body.simulation_id||null,category:body.category,mime:body.mime,size:bytes.length,sha256:hash,storage_key:key,issued_on:issued,expires_on:expires,issuer:String(body.issuer??'').slice(0,300),reference:String(body.reference??'').slice(0,300),signature_method:null,signature_evidence_id:null,signature_review:'pending',requirement_id:uuid(body.requirement_id)?body.requirement_id:null};
   send(res,201,await put(c,'document',id,0,payload));return true;
  }
  const signingSource=path.match(/^\/api\/app\/documents\/([a-f0-9-]{36})\/signing-source$/);
  if(signingSource&&req.method==='POST'){
   write(c);if(!['editor','manager'].includes(c.role))fail('A assinatura exige o perfil de Elaboração.',403);const body=await jsonBody(req,1000);if(body.confirm!==true)fail('Confirme a assinatura no aplicativo local.');const doc=await related(c,signingSource[1],'document');
   requireDocumentExport(doc,await list(c,'document'),c.role);if(doc.mime!=='application/pdf'||doc.category==='manufacturer_manual'||!doc.storage_key?.startsWith(c.tenant+'/'))fail('Selecione o PDF original para assinatura.');const bytes=Buffer.from(await(await store.download(doc.storage_key)).arrayBuffer());if(bytes.length!==doc.size||digest(bytes)!==doc.sha256)fail('Integridade não confirmada.',409);await store.security(c,'document_signing_requested',{document_id:doc.id,sha256:doc.sha256,display_name:c.display_name});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(bytes);return true;
  }
  const controlledDocument=path.match(/^\/api\/app\/documents\/([a-f0-9-]{36})\/view\/(\d{1,5})$/);
  if(controlledDocument&&req.method==='GET'){
   if(c.role==='finance')fail('Perfil sem acesso aos documentos técnicos.',403);const doc=await related(c,controlledDocument[1],'document');if(!doc.storage_key?.startsWith(c.tenant+'/'))fail('Arquivo fora deste workspace.',403);
   const bytes=Buffer.from(await(await store.download(doc.storage_key)).arrayBuffer());if(bytes.length!==doc.size||digest(bytes)!==doc.sha256)fail('Integridade não confirmada.',409);
   const result=await controlledPage(bytes,doc.mime,Number(controlledDocument[2]),{renderer:documentRenderer});await store.security(c,'document_viewed',{document_id:doc.id,page:Number(controlledDocument[2]),sha256:doc.sha256,controlled:true,display_name:c.display_name});send(res,200,{...result,name:doc.name,control:'by EnergyOS PEE · DOC-'+doc.id+' · v'+doc.version+' · SHA-256 '+doc.sha256});return true;
  }
  const viewing=path.match(/^\/api\/app\/documents\/([a-f0-9-]{36})\/pages\/(\d{1,3})$/);
  if(viewing&&req.method==='GET'){
   if(c.role==='finance')fail('Perfil sem acesso aos documentos técnicos.',403);
   const doc=await related(c,viewing[1],'document');if(doc.mime!=='application/pdf'||!doc.storage_key.startsWith(c.tenant+'/'))fail('Consulta por páginas disponível somente para PDFs deste workspace.',403);
   const bytes=Buffer.from(await(await store.download(doc.storage_key)).arrayBuffer());if(bytes.length!==doc.size||digest(bytes)!==doc.sha256)fail('Integridade não confirmada.',503);
   const page=Number(viewing[2]),result=await documentRenderer(bytes,page);if(protection)await store.security(c,'document_viewed',{document_id:doc.id,page,sha256:doc.sha256,display_name:c.display_name});
   res.setHeader('Content-Type','image/png');res.setHeader('X-Document-Pages',String(result.total));res.setHeader('Content-Disposition','inline');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(result.image);return true;
  }
  const download=path.match(/^\/api\/app\/documents\/([a-f0-9-]{36})\/download$/);
  if(download&&req.method==='GET'){
   const doc=await related(c,download[1],'document');if(protection){await store.security(c,'document_export_denied',{document_id:doc.id,display_name:c.display_name});fail('Download indisponível. Consulte o documento em tela e utilize Comunicações para enviar à banca cadastrada.',403);}if(!doc.storage_key.startsWith(c.tenant+'/'))fail('Documento fora deste workspace.',403);
   const response=await store.download(doc.storage_key),bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>20971520||digest(bytes)!==doc.sha256)fail('Não foi possível confirmar a integridade do arquivo.',503);
   res.setHeader('Content-Type',doc.mime);res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(doc.name));res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(bytes);return true;
  }
  if(await handleDocumentSignatures({req,res,path,c,get:related,put,jsonBody,send}))return true;
  const workflow=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/phase$/);
  if(workflow&&req.method==='POST'){
   review(c);const body=await jsonBody(req),data=await snapshot(c,workflow[1]),check=assessProject(data);if(['Pronto para submissão','Submetido'].includes(body.phase))requireEvaluationContact(data.rule);const transition=validateTransition(data.project,body.phase,check,body.decision);
   if(body.decision?.document_id){const d=await related(c,body.decision.document_id,'document');if(d.project_id!==workflow[1]||d.category!=='official_decision'||d.signature_review!=='verified')fail('Comprove com documento oficial deste projeto.');}
   const p=await put(c,'project',data.project.id,number(body.version,'versão',1),{...data.project,phase:transition.phase,decision:transition.decision});await put(c,'workflow',randomUUID(),0,{project_id:p.id,...transition,note:String(body.note??'').slice(0,4000),actor:c.subject,at:new Date().toISOString()});send(res,200,p);return true;
  }
  send(res,404,{message:'Operação não encontrada.'});return true;
 }};
}
