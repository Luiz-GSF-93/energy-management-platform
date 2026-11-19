import {scoringMethods,scoringMetrics} from './scoring.mjs';
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
const flatten=r=>({...r.payload,id:r.id,version:r.version,created_at:r.created_at,updated_at:r.updated_at});
async function jsonBody(req,max=600000){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))fail('Use JSON.',415);const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>max)fail('Arquivo ou dados excedem o limite.',413);chunks.push(part);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('Dados inválidos.');}}
const mimeTypes=['application/pdf','image/jpeg','image/png','text/csv','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const categories=['manufacturer_manual','bills','baseline','diagram','art','budgets','mv_plan','consent','signature_evidence','official_decision','edital','cnpj_status','distributor_clearance','tax_clearance','labor_clearance','fgts','other'];
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
 async function snapshot(c,id){if(!uuid(id))fail('Identificador inválido.');const raw=await store.rpc(c,'snapshot',{project_id:id}),p=flatten(raw.project),rows=raw.records.map(r=>({...flatten(r),kind:r.kind}));return {project:p,simulations:rows.filter(r=>r.kind==='simulation'),documents:rows.filter(r=>r.kind==='document'),workflow:rows.filter(r=>r.kind==='workflow'),rule:rows.find(r=>r.kind==='rule'),company:rows.find(r=>r.kind==='company'),unit:rows.find(r=>r.kind==='unit'),workspace,actor:c.subject,fingerprint:raw.technical_hash,snapshot_hash:raw.snapshot_hash};}

 async function put(c,kind,id,version,payload){return flatten(await store.rpc(c,'put',{kind,id,expected_version:version,payload}));}
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
   return {name:text(x.name,'nome do edital'),distributor:text(x.distributor,'distribuidora'),edition:text(x.edition,'versão do edital',100),source_url:u.href,document_id:attachment?.id??null,source_hash:attachment?.sha256??null,deadline,qualification,criteria,rcb_basis:x.rcb_basis??null,allowed_typologies:allowedTypologies,allowed_types:allowedTypes,minimum_annual_mwh:x.minimum_annual_mwh==null?null:number(x.minimum_annual_mwh,'consumo mínimo'),minimum_peak_kw:x.minimum_peak_kw==null?null:number(x.minimum_peak_kw,'demanda mínima'),reviewed:x.reviewed===true,max_rcb:x.max_rcb==null?null:number(x.max_rcb,'RCB máxima',0.001,100),requirements:x.requirements.map(r=>({id:uuid(r.id)?r.id:randomUUID(),label:text(r.label,'exigência',2000),document_required:r.document_required===true})),reviewed_by:x.reviewed===true?c.subject:null,reviewed_at:x.reviewed===true?new Date().toISOString():null};
  }
  fail('Use a operação específica deste módulo.',403);
 }
 return {async handle(req,res,path,authorize){
  if(req.method==='GET'&&path==='/commercial'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");res.end(await readFile(new URL('web/commercial.html',import.meta.url)));return true;
  }
  if(req.method==='GET'&&path==='/assets/comercial.mp4'){
   const file=new URL('web/comercial.mp4',import.meta.url),size=(await stat(file)).size;res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
   if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return true;}
    const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;if(start>=size||start>end){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return true;}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});createReadStream(file,{start,end}).pipe(res);return true;
   }res.setHeader('Content-Length',size);createReadStream(file).pipe(res);return true;
  }
  if(req.method==='GET'&&path.startsWith('/assets/')){
   const assets={'/assets/app.js':['application/javascript; charset=utf-8','web/app.js'],'/assets/activity.mjs':['application/javascript; charset=utf-8','web/activity.mjs'],'/assets/workspace-modules.mjs':['application/javascript; charset=utf-8','web/workspace-modules.mjs'],'/assets/app.css':['text/css; charset=utf-8','web/app.css'],'/assets/logo.png':['image/png','web/logo.png'],'/assets/favicon.ico':['image/x-icon','web/favicon.ico'],'/assets/comercial.vtt':['text/vtt; charset=utf-8','web/comercial.vtt'],'/assets/comercial-poster.jpg':['image/jpeg','web/comercial-poster.jpg']};
   const match=assets[path]??({'/assets/fonts.css':['text/css; charset=utf-8','web/fonts.css'],'/assets/brand.css':['text/css; charset=utf-8','web/brand.css'],'/assets/energyos-icon.svg':['image/svg+xml','web/energyos-icon.svg']}[path])??(/^\/assets\/font-[a-f0-9]{12}\.ttf$/.test(path)?['font/ttf','web/'+path.split('/').at(-1)]:null);if(!match)return false;res.setHeader('Content-Type',match[0]);res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:");res.end(await readFile(new URL(match[1],import.meta.url)));return true;
  }
  if(path!=='/app'&&!path.startsWith('/api/app/'))return false;
  const {session:s,grant:g}=await authorize(req);const c={source:'core',tenant:s.tenant,subject:s.subject,role:g.role,monthly_limit:g.monthly_project_limit};
  limit(c,req.method);
  if(req.method==='GET'&&path==='/app'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");res.end(await readFile(new URL('web/index.html',import.meta.url)));return true;
  }
  if(req.method!=='GET'){if(req.headers.origin!==publicOrigin||req.headers['x-csrf-token']!==s.csrf)fail('Confirme novamente seu acesso para continuar.',403);}
  if(req.method==='GET'&&path==='/api/app/bootstrap'){
   const data=Object.fromEntries(await Promise.all(kinds.map(async k=>[k,await list(c,k)])));send(res,200,{identity:{workspace,role:c.role,subject:c.subject,monthly_limit:c.monthly_limit,csrf:s.csrf,expires_at:g.expires_at,core_url:coreOrigin+'/pee',activity_enabled:activityEnabled,idle_seconds:900},guide:guideReference,selection_criteria:selectionCriteria,scoring_metrics:scoringMetrics,scoring_methods:scoringMethods,typologies,types,inputs:opportunityInputs,reports:reportTypes,sections:requiredSections,data});return true;
  }
  if(req.method==='GET'&&path==='/api/app/audit'){send(res,200,{items:await store.rpc(c,'audit')});return true;}
  if(req.method==='GET'&&path==='/api/app/license'){send(res,200,await store.rpc(c,'usage',{monthly_limit:c.monthly_limit}));return true;}
  const detail=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/details$/);
  if(detail&&req.method==='POST'){
   write(c);if(c.role==='reviewer')fail('O perfil de revisão não altera o levantamento técnico.',403);
   const p=await related(c,detail[1],'project'),body=await jsonBody(req,7000000),version=number(body.version,'versão',1),kind=body.kind;let patch;
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
  const analysis=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/analysis$/);
  if(analysis&&req.method==='GET'){const data=await snapshot(c,analysis[1]);send(res,200,assessProject(data));return true;}
  const report=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/reports\/(final|presentation|diagnosis|memorial|mv|economics|schedule|documents|compliance|progress)$/);
  if(report&&req.method==='POST'){
   write(c);const body=await jsonBody(req),data=await snapshot(c,report[1]),html=renderReport(data,report[2]),hash=digest(html);
   if(report[2]==='final'){if(!uuid(body.request_id))fail('Identificador de emissão obrigatório.');await store.rpc(c,'emit',{id:body.request_id,project_id:report[1],document_hash:hash,snapshot_hash:data.snapshot_hash,monthly_limit:c.monthly_limit});}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="EnergyOS-PEE-${report[1]}-${report[2]}.html"`);res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox");res.setHeader('X-Document-SHA256',hash);res.end(html);return true;
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
   review(c);const body=await jsonBody(req),data=await snapshot(c,workflow[1]),check=assessProject(data),transition=validateTransition(data.project,body.phase,check,body.decision);
   if(body.decision?.document_id){const d=await related(c,body.decision.document_id,'document');if(d.project_id!==workflow[1]||d.category!=='official_decision'||d.signature_review!=='verified')fail('Comprove com documento oficial deste projeto.');}
   const p=await put(c,'project',data.project.id,number(body.version,'versão',1),{...data.project,phase:transition.phase,decision:transition.decision});await put(c,'workflow',randomUUID(),0,{project_id:p.id,...transition,note:String(body.note??'').slice(0,4000),actor:c.subject,at:new Date().toISOString()});send(res,200,p);return true;
  }
  send(res,404,{message:'Operação não encontrada.'});return true;
 }};
}
