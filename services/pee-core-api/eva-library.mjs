import{createHash}from'node:crypto';
import{mkdtemp,writeFile,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';
import{execFile}from'node:child_process';import{promisify}from'node:util';
import{workbookView}from'./controlled-view.mjs';
import{requiredSections}from'./project-policy.mjs';
import{economicFormulae}from'./document-control.mjs';
import{templateCatalog,renderTemplate}from'./template-library.mjs';
const run=promisify(execFile),hash=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
const plain=x=>String(x??'').replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,' ').replace(/[\x00-\x08\x0b\x0e-\x1f]/g,' ').replace(/[ \t]+/g,' ').trim();
const redact=x=>x.replace(/\bBearer\s+[a-z0-9._~+\/-]+/gi,'[credencial omitida]').replace(/\b(?:sb_secret_|sk-|re_)[a-z0-9_-]{20,}/gi,'[credencial omitida]').replace(/\b(?:senha|password|api[_ -]?key|secret)\s*[:=]\s*\S+/gi,'[credencial omitida]');
const fold=x=>x.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stop=new Set('para como quais qual sobre deve devo com uma das dos que por pelo pela este esta esse essa mais ser sao nao nos nas seu sua dados conferir preencher projeto projetos pee aneel'.split(' '));
const terms=x=>[...new Set((fold(x).match(/[a-z0-9]{2,}/g)??[]).filter(t=>!stop.has(t)))].slice(0,50);
export async function extractLibraryFile(bytes,mime,{execute=run}={}){
 if(bytes.length>20971520)throw Error('size_limit');
 if(['application/pdf','image/png','image/jpeg'].includes(mime)){
  if(mime==='application/pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw Error('invalid_pdf');let folder;
  if(mime==='image/png'&&(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16000000))throw Error('size_limit');
  if(mime==='image/jpeg'){
   if(bytes[0]!==255||bytes[1]!==216)throw Error('invalid_image');let found=false;
   for(let at=2,segments=0;at+9<bytes.length&&segments<10000;segments++){
    if(bytes[at]!==255)throw Error('invalid_image');const marker=bytes[at+1];if(marker===255){at++;continue;}if(marker===0xd9||marker===0xda)break;const size=bytes.readUInt16BE(at+2);if(size<2||at+2+size>bytes.length)throw Error('invalid_image');
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(bytes.readUInt16BE(at+5)*bytes.readUInt16BE(at+7)>16000000)throw Error('size_limit');found=true;break;}at+=2+size;
   }if(!found)throw Error('invalid_image');
  }
  try{
   folder=await mkdtemp(join(tmpdir(),'pee-eva-'));const input=join(folder,mime==='application/pdf'?'source.pdf':mime==='image/png'?'source.png':'source.jpg');await writeFile(input,bytes,{mode:0o600});
   const options={timeout:20000,maxBuffer:4000000,windowsHide:true,env:{...process.env,OMP_THREAD_LIMIT:'1'}};
   if(mime!=='application/pdf'){const r=await execute('tesseract',[input,'stdout','-l','por+eng'],options);return[{page:1,text:plain(r.stdout),ocr:true}];}
   const info=await execute('pdfinfo',[input],{...options,maxBuffer:65536}),total=Number(/^Pages:\s+(\d+)\s*$/m.exec(info.stdout)?.[1]);if(!Number.isInteger(total)||total<1||total>250)throw Error('page_limit');
   const r=await execute('pdftotext',['-layout','-enc','UTF-8',input,'-'],options),texts=r.stdout.split('\f'),pages=[];
   for(let i=0;i<total;i++){
    let text=plain(texts[i]),ocr=false;
    if(text.length<30){const output=join(folder,'page');await execute('pdftoppm',['-f',String(i+1),'-l',String(i+1),'-singlefile','-scale-to','1600','-png',input,output],{...options,maxBuffer:65536});const result=await execute('tesseract',[output+'.png','stdout','-l','por+eng'],options);text=plain(result.stdout);ocr=true;}
    if(text)pages.push({page:i+1,text,ocr});
   }return pages;
  }
  finally{if(folder)await rm(folder,{recursive:true,force:true});}
 }
 if(mime.endsWith('spreadsheetml.sheet')||['text/plain','text/csv'].includes(mime)){const lines=(mime.endsWith('spreadsheetml.sheet')?workbookView(bytes):bytes.toString('utf8')).replace(/\r\n/g,'\n').split('\n');if(lines.length>12500)throw Error('page_limit');return Array.from({length:Math.max(1,Math.ceil(lines.length/50))},(_,i)=>({page:i+1,text:lines.slice(i*50,(i+1)*50).join('\n')}));}
 throw Error('needs_text_or_ocr');
}
export function libraryChunks(item,pages){const result=[];for(const p of pages){const text=redact(plain(p.text));for(let at=0;at<text.length;at+=1400){const excerpt=text.slice(at,at+1600);if(excerpt.trim().length<15)continue;result.push({...item,page:p.page,ocr:p.ocr===true,excerpt,source_id:'lib_'+hash(item.reference+':'+item.sha256+':'+p.page+':'+at).slice(0,24)});}}return result;}
export function rankLibrary(chunks,question,field,projectId){
 const words=terms(question+' '+({economic:'rcb custo economia investimento',technical:'equipamento diagnostico manual',mv:'medicao verificacao baseline',documents:'documento assinatura',selection:'pontuacao criterio',eligibility:'edital elegibilidade',submission:'cronograma prazo',execution:'execucao acompanhamento'}[field]??''));
 const scored=chunks.map((c,i)=>{const body=fold(c.excerpt),title=fold(c.title),score=words.reduce((s,t)=>s+(title.includes(t)?4:0)+(body.includes(t)?1:0),0);return{c,i,score:score+(score&&projectId&&c.project_id===projectId?3:0)};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.i-b.i);
 const chosen=[],counts=new Map();for(const x of scored){const n=counts.get(x.c.reference)??0;if(n>=2)continue;chosen.push(x.c);counts.set(x.c.reference,n+1);if(chosen.length===6)break;}return chosen;
}
// Private excerpts are cached only in this process, partitioned by tenant and
// checked against a fresh authorized manifest before every retrieval. No public
// storage links, credentials or inter-workspace search enter the model context.
export function createEvaLibrary({store,list,snapshot,extract=extractLibraryFile,maxChars=8000000,maxTenants=8}={}){
 const indexes=new Map();let building=false;
 async function manifest(c){if(!uuid(c.tenant)||!uuid(c.subject)||c.role==='finance')throw Error('library_scope');const kinds=['document','project','company','unit','rule','simulation','workflow'],rows=await Promise.all(kinds.map(k=>list(c,k))),[documents,projects,companies]=rows;const signature=hash(JSON.stringify([c.tenant,...rows.map(items=>items.map(d=>[d.id,d.version,d.sha256,d.storage_key]).sort())]));return{documents,projects,companies,signature};}
 function summary(i){return{state:i.state,total:i.total,processed:i.processed,indexed:i.indexed,unreadable:i.issues.length,issues:i.issues.slice(0,100),complete:i.state==='ready'&&i.issues.length===0,updated_at:i.updated_at,notice:'A busca considera os documentos deste workspace. Arquivos ilegíveis e limites são informados; modelos e exemplos não comprovam cumprimento regulatório.'};}
 async function build(c,m,i,verify){building=true;let size=0;
  const append=(item,pages)=>{const chunks=libraryChunks(item,pages);const chars=chunks.reduce((s,c)=>s+c.excerpt.length,0);if(size+chars>maxChars)throw Error('index_capacity');size+=chars;i.chunks.push(...chunks);i.indexed++;};
  try{
   for(const d of m.documents){await verify();try{
    if(d.storage_key!==c.tenant+'/'+d.id+'/'+d.sha256||!Number.isInteger(d.size)||d.size>20971520)throw Error('integrity');
    const response=await store.download(d.storage_key);if(response.headers?.get('content-length')&&Number(response.headers.get('content-length'))>20971520)throw Error('size_limit');
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==d.size||hash(bytes)!==d.sha256)throw Error('integrity');
    const pages=await extract(bytes,d.mime);if(!pages.some(p=>p.text?.trim().length>15))throw Error('needs_text_or_ocr');
    append({kind:'document',document_id:d.id,project_id:d.project_id,title:d.name.slice(0,200),reference:'DOC-'+d.id,version:d.version,sha256:d.sha256,demonstration:!!(d.demonstration||d.model_document),signature_review:d.signature_review??'pending'},pages);
   }catch(e){i.issues.push({document_id:d.id,title:d.name,reason:['integrity','size_limit','index_capacity','page_limit'].includes(e.message)?e.message:'needs_text_or_ocr'});}finally{i.processed++;}}
   for(const t of templateCatalog){const text=t.title+' — modelo da biblioteca EnergyOS PEE. Categoria: '+t.category+'. Formatos: '+t.formats.join(', ')+'. Campos a conferir: '+Object.values(requiredSections).join('; ')+(['economics','workbook'].includes(t.id)?'. Fórmulas de referência: '+JSON.stringify(economicFormulae):'')+'. O modelo não substitui formulários oficiais, assinatura ou conferência técnica.';try{append({kind:'template',title:t.title,reference:'CATALOGO-'+t.id,version:t.version,sha256:hash(text),demonstration:true,signature_review:'not_signed'},[{page:1,text}]);}catch{i.issues.push({title:t.title,reason:'index_capacity'});}}
   for(const p of m.projects){await verify();const data=await snapshot(c,p.id);data.organization=m.companies.find(x=>x.platform_organization===true);
    for(const t of templateCatalog){try{const model=renderTemplate(data,t.id);append({kind:'template',project_id:p.id,title:t.title,reference:model.reference,version:t.version,sha256:hash(model.html),demonstration:true,signature_review:'not_signed'},[{page:1,text:plain(model.html)}]);}catch{if(t.id!=='art'||data.project.demonstration)i.issues.push({project_id:p.id,title:t.title,reason:'model_unavailable'});}}
   }
   await verify();i.state='ready';i.until=Date.now()+600000;i.updated_at=new Date().toISOString();
  }catch{i.state='failed';i.retry_at=Date.now()+60000;i.chunks=[];i.issues.push({title:'Consulta da biblioteca',reason:'authorization_or_snapshot_changed'});}finally{building=false;}
 }
 return{async prepare(c,verify=async()=>{}){
   if(!uuid(c.tenant)||!uuid(c.subject)||c.role==='finance')throw Error('library_scope');const pending=indexes.get(c.tenant);if(pending?.state==='indexing')return summary(pending);
   const m=await manifest(c),now=Date.now();for(const[k,v]of indexes)if(v.until<now&&v.state!=='indexing')indexes.delete(k);
   let i=indexes.get(c.tenant);if(i&&i.signature===m.signature&&(i.state!=='failed'||i.retry_at>now)){i.until=now+600000;return summary(i);}
   if(building)return{state:'waiting',total:m.documents.length,processed:0,indexed:0,unreadable:0,issues:[],complete:false};
   if(indexes.size>=maxTenants&&!indexes.has(c.tenant)){const oldest=[...indexes].filter(([,v])=>v.state!=='indexing').sort((a,b)=>a[1].until-b[1].until)[0];if(oldest)indexes.delete(oldest[0]);else throw Error('library_busy');}
   i={signature:m.signature,state:'indexing',total:m.documents.length,processed:0,indexed:0,chunks:[],issues:[],until:now+600000,updated_at:null};indexes.set(c.tenant,i);void build({...c},m,i,verify);return summary(i);
  },async retrieve(c,{question,field,project_id}){
   const m=await manifest(c),i=indexes.get(c.tenant);if(!i||i.signature!==m.signature||i.state!=='ready'||i.until<Date.now())return{ready:false,status:i?summary(i):{state:'not_indexed'}};
   if(project_id&&!m.projects.some(p=>p.id===project_id))throw Error('library_scope');
   const chunks=rankLibrary(i.chunks,question,field,project_id);return{ready:true,status:summary(i),chunks};
  }};
}
