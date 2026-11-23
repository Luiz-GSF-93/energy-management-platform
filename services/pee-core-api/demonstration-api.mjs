import{ProjectError}from'./project-policy.mjs';
import{validateDemoSettings,demonstrationSourceHash,demonstrationPresentation,extractDemonstrationDocument,demoDigest}from'./demonstration.mjs';
import{buildDemonstrationInWorker}from'./demonstration-renderer.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fail=(m,s=422)=>{throw new ProjectError(m,s);};
export function createDemonstrationApi({store,snapshot,put,get,assessment,build=buildDemonstrationInWorker,controlledViews}={}){
 const jobs=new Map();
 function prune(){const now=Date.now();for(const[id,j]of jobs)if(j.state!=='preparing'&&j.created_at<now-3600000)jobs.delete(id);}
 return{async handle(req,res,path,c,{jsonBody,send,reauthorize}){
  const route=path.match(/^\/api\/app\/projects\/([a-f0-9-]{36})\/demonstration(?:\/(prepare|view|notes|jobs|documents)(?:\/([a-zA-Z0-9_-]+))?)?$/);if(!route)return false;
  if(c.role==='finance')fail('Este perfil não acessa a demonstração técnica.',403);
  const data=await snapshot(c,route[1]),p=data.project,operation=route[2],ref=route[3];prune();
  if(!operation&&req.method==='GET'){const real=assessment(data),job=[...jobs.values()].find(j=>j.tenant===c.tenant&&j.actor===c.subject&&j.project===p.id&&j.state==='preparing');send(res,200,{...(demonstrationPresentation(data,real)??{active:false,enabled:false,manifest:null}),preparing_job:job?{id:job.id,state:job.state,progress:job.progress}:null});return true;}
  if(operation==='notes'&&req.method==='POST'){
   if(!['editor','manager'].includes(c.role))fail('O preenchimento do exemplo exige Elaboração.',403);const body=await jsonBody(req,5000),demo=p.demonstration,m=demo?.manifest;
   if(body.version!==p.version||!m||!m.checks.some(c=>c.id===body.check_id)&&!m.validations.some(c=>c.check_id===body.check_id))fail('Atualize o requisito do exemplo antes de salvar.',409);
   const notes=validateDemoSettings({team:m.team,bill_history:m.bill_history,notes:{...(demo.notes??m.notes??{}),[body.check_id]:{signer:body.signer,note:body.note}}},data).notes;
   send(res,200,await put(c,'project',p.id,p.version,{...p,demonstration:{...demo,notes,enabled:false,needs_regeneration:true}}));return true;
  }
  if(operation==='jobs'&&req.method==='GET'){
   const job=jobs.get(ref);if(!job||job.tenant!==c.tenant||job.project!==p.id)fail('Preparação não encontrada neste projeto. Atualize o projeto para verificar o resultado.',404);send(res,200,{id:job.id,state:job.state,progress:job.progress,message:job.message??null});return true;
  }
  if(operation==='view'&&req.method==='POST'){
   if(!['editor','reviewer','manager'].includes(c.role))fail('Seu perfil não altera a apresentação do projeto.',403);const body=await jsonBody(req,1000);if(typeof body.enabled!=='boolean'||body.version!==p.version||!p.demonstration)fail('Atualize o projeto antes de alterar a visualização.',409);
   if(body.enabled&&!demonstrationPresentation(data,assessment(data))?.current)fail('Os dados mudaram. Prepare novamente o exemplo antes de exibi-lo.',409);
   send(res,200,await put(c,'project',p.id,p.version,{...p,demonstration:{...p.demonstration,enabled:body.enabled}}));return true;
  }
  if(operation==='prepare'&&req.method==='POST'){
   if(!['editor','manager'].includes(c.role))fail('A preparação dos dados fictícios exige o perfil de Elaboração.',403);
   const body=await jsonBody(req,40000);if(body.acknowledged!==true||!uuid(body.request_id))fail('Confirme a preparação de um exemplo fictício, sem validade para submissão.');if(body.version!==p.version)fail('O projeto mudou. Atualize antes de preparar o exemplo.',409);
   const real=assessment(data);if(!data.organization?.name||!data.organization?.cnpj||!data.organization?.address)fail('Complete o cadastro da organização elaboradora na Biblioteca de modelos.');if(!real.economy||real.economy.funding_status!=='budget_reconciled'||!Number.isFinite(real.economy.annual_benefit)||real.economy.annual_benefit<=0)fail('Complete as simulações e concilie o orçamento antes de preparar o exemplo.');
   if(!data.company||!data.unit||!p.schedule?.length||Object.keys(data.project.sections??{}).length<14||Object.values(p.sections).some(s=>!String(s).trim()))fail('Complete a identificação, as seções do projeto e o cronograma antes de preparar o exemplo.');
   const settings=validateDemoSettings({team:body.team,bill_history:body.bill_history,notes:p.demonstration?.notes??p.demonstration?.manifest?.notes},data);
   const existing=jobs.get(body.request_id);if(existing){if(existing.tenant!==c.tenant||existing.project!==p.id||existing.actor!==c.subject)fail('Identificador de preparação indisponível.',409);send(res,202,{job_id:existing.id,state:existing.state});return true;}
   const active=[...jobs.values()].filter(j=>j.state==='preparing');if(active.some(j=>j.tenant===c.tenant&&j.project===p.id)||active.length>=2||jobs.size>=100)fail('Há uma preparação em andamento. Aguarde sua conclusão.',429);
   const job={id:body.request_id,tenant:c.tenant,actor:c.subject,project:p.id,created_at:Date.now(),state:'preparing',progress:{done:0,total:1,title:'Preparando documentos'}};jobs.set(job.id,job);send(res,202,{job_id:job.id,state:job.state});
   void(async()=>{
    try{
     const sourceHash=demonstrationSourceHash(data),result=await build(data,assessment(data),settings,{onProgress:progress=>{job.progress=progress;}}),fresh=await reauthorize();
     if(fresh.grant.role!==c.role)fail('A permissão mudou durante a preparação. Reabra o projeto.',403);
     const latest=await snapshot(c,p.id);if(latest.project.version!==p.version||demonstrationSourceHash(latest)!==sourceHash)fail('Os dados mudaram durante a preparação. Atualize e gere novamente.',409);
     const id=job.id,key=c.tenant+'/'+id+'/'+result.manifest.package_sha256;await store.upload(key,result.bytes,'application/pdf');
     await put(c,'document',id,0,{name:result.manifest.reference+'-dossie-demonstrativo.pdf',project_id:null,demonstration_project_id:p.id,demonstration_only:true,category:'other',mime:'application/pdf',size:result.bytes.length,sha256:result.manifest.package_sha256,storage_key:key,signature_method:null,signature_evidence_id:null,signature_review:'pending',reference:result.manifest.reference,issuer:'EnergyOS PEE — exemplo fictício, sem assinatura real'});
     await put(c,'project',p.id,p.version,{...p,demonstration:{example_only:true,enabled:true,package_id:id,revision:(p.demonstration?.revision??0)+1,prepared_by:c.display_name??c.subject,prepared_at:result.manifest.emitted_at,manifest:result.manifest}});
     job.state='completed';job.progress={done:result.manifest.documents.length,total:result.manifest.documents.length,title:'Exemplo completo —100% demonstrativo'};
    }catch(error){job.state='failed';job.message=error instanceof ProjectError||error?.status?error.message:'A preparação não foi concluída. Atualize o projeto antes de repetir.';}
   })();return true;
  }
  if(operation==='documents'&&['GET','POST'].includes(req.method)){
   if(!['editor','reviewer','manager'].includes(c.role))fail('Seu perfil permite consultar os dados, mas não exportar documentos.',403);
   const demo=p.demonstration;if(!demo?.package_id||!demo.manifest)fail('Prepare primeiro o dossiê do exemplo.',404);const doc=await get(c,demo.package_id,'document');
   if(doc.demonstration_only!==true||doc.demonstration_project_id!==p.id||!doc.storage_key?.startsWith(c.tenant+'/')||doc.size>20971520)fail('Documento indisponível neste projeto.',403);
   const original=Buffer.from(await(await store.download(doc.storage_key)).arrayBuffer());if(original.length!==doc.size||demoDigest(original)!==doc.sha256||doc.sha256!==demo.manifest.package_sha256)fail('A integridade do dossiê não foi confirmada.',409);
   const bytes=ref==='all'?original:await extractDemonstrationDocument(original,demo.manifest,ref),name=demo.manifest.reference+'-'+(ref??'all')+'.pdf';if(req.method==='POST'){const b=await jsonBody(req,1000);if(b.preview!==true)fail('Abra o documento pela consulta controlada.');send(res,200,controlledViews.register(c,{bytes,mime:'application/pdf',name,project_id:p.id}));return true;}if(process.env.PEE_CONTENT_PROTECTION_ENABLED==='true')fail('Consulte o exemplo em tela. Downloads indisponíveis.',403);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(bytes);return true;
  }
  fail('Operação demonstrativa inválida.',405);
 }};
}
