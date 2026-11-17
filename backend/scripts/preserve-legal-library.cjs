// Explicit Owner maintenance. Reuses existing private storage; no app bootstrap, OCR or AI.
// Run after build, with existing service environment: node scripts/preserve-legal-library.cjs OWNER_UUID MANIFEST_PATH
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const {ConfigService}=require('@nestjs/config'),{SupabaseService}=require('../dist/services/supabase.service'),{EvaOfficialSourceService}=require('../dist/modules/ocr/eva-official-source.service'),{EvaOfficialDocumentService}=require('../dist/modules/ocr/eva-official-document.service'),{EvaOriginalBlobConnector}=require('../dist/modules/ocr/eva-original-blob.connector'),{EvaExtractionBlobReader}=require('../dist/modules/ocr/eva-extraction-blob.reader');
const actor=process.argv[2],manifestPath=path.resolve(process.argv[3]||''),root=path.dirname(manifestPath),statePath=path.join(root,'energyos-preservation-state.json');
if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(actor||'')||!fs.existsSync(manifestPath))throw Error('Explicit Owner and downloaded public manifest required');
const config=new ConfigService(),db=new SupabaseService(config),sources=new EvaOfficialSourceService(db,config),originals=new EvaOfficialDocumentService(db,config,new EvaOriginalBlobConnector(config)),reader=new EvaExtractionBlobReader(config),catalog=require('../src/modules/ocr/legal-audit.library.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{},hash=x=>crypto.createHash('sha256').update(x).digest('hex'),persist=()=>fs.writeFileSync(statePath,JSON.stringify(state,null,2),{mode:0o600});
const command=(key,entry)=>{entry[key]??={requestId:crypto.randomUUID(),expectedEventId:null,expectedRevisionHash:null,justification:'Preservação solicitada pelo Owner para biblioteca oficial EnergyOS. Não corresponde a revisão normativa ou publicação de conformidade.'};persist();return entry[key];};
async function rpc(action,id,body){const r=await db.getClient().rpc('legal_library_file_action',{p_actor:actor,p_org:null,p_role:'',p_platform:false,p_action:action,p_id:id,p_body:body});if(r.error)throw Object.assign(Error('Library '+action+' failed'),{code:r.error.code});return r.data;}
async function indexFile(sourceId,documentId,bytes){
 const reference=await rpc('original',documentId,{});if(bytes.length!==reference.size||hash(bytes)!==reference.fileHash)throw Error('PUBLIC_FILE_INTEGRITY');
 const pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href),pdf=await pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,verbosity:0}).promise;
 try{
  if(pdf.numPages<1||pdf.numPages>1000)throw Error('PUBLIC_PAGE_LIMIT');const pages=[];let size=0;
  for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),content=await page.getTextContent(),text=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');size+=Buffer.byteLength(text);if(size>7500000||text.length>200000)throw Error('PUBLIC_TEXT_LIMIT');pages.push({page:n,text});page.cleanup();}
  const answer=await rpc('index',documentId,{sourceId,fileHash:reference.fileHash,pages,metadata:{method:'NATIVE_PDF_TEXT',allPages:true,unreadablePages:pages.filter(p=>p.text.trim().length<30).map(p=>p.page),normativeReview:'PENDING',provenance:reference.metadata.provenance}});return {...answer,pageCount:pages.length};
 }finally{await pdf.destroy();}
}
function sourceIdentity(source,row){const u=new URL(row.url);let authority,family;if(u.hostname.endsWith('ccee.org.br'))[authority,family]=['CCEE','CCEE_RULES'];else if(u.hostname.endsWith('ons.org.br'))[authority,family]=['ONS',source.id==='ons-procedimentos'?'ONS_PROCEDURES':'ONS_REPORTS'];else if(source.id.startsWith('cnpe'))[authority,family]=['CNPE','CNPE_RESOLUTIONS'];else if(source.id.startsWith('epe'))[authority,family]=['EPE','ENERGY_PLANNING'];else if(source.id.startsWith('mme')||source.id==='lei15269')[authority,family]=['MME','MME_LEGISLATION'];else [authority,family]=['PLANALTO','LEGISLATION'];return {authority,family};}
(async()=>{
 // This read enforces the active canonical Owner before any storage/provider action.
 await sources.list(actor,{page:'0'});
 const indexed=await rpc('list',null,{});
 for(const row of manifest){
  if(row.state!=='DOWNLOADED_NOT_YET_REGISTERED'){console.log(JSON.stringify({sourceId:row.sourceId,state:'PENDING_OFFICIAL_FILE'}));continue;}
  const source=catalog.find(s=>s.id===row.sourceId);if(!source)throw Error('Unknown registered catalogue source');
  const local=path.resolve(row.path);if(path.dirname(local)!==root)throw Error('Public manifest path outside root');const bytes=fs.readFileSync(local);if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw Error('Downloaded public file changed');
  const entry=state[row.sourceId]??={};persist();
  const done=indexed.find(f=>f.sourceId===row.sourceId&&f.fileHash===row.sha256);if(done){entry.result=done;persist();console.log(JSON.stringify({sourceId:row.sourceId,state:'INDEXED_REUSED',pages:done.pages}));continue;}
  try{
   if(!entry.sourceId){const kind=sourceIdentity(source,row),origin=new URL(row.url).search?source.url:row.url;const body=command('create',entry);body.metadata??={title:source.title.slice(0,155),...kind,url:origin,markets:['COMMON'],scopeNote:'Arquivo público capturado a pedido do Owner. Preservação não certifica vigência ou conformidade; requer revisão de aplicabilidade.',cadenceDays:30};persist();entry.sourceId=(await sources.command(actor,null,'create',body)).sourceId;persist();}
   let src=await sources.detail(actor,entry.sourceId);
   if(src.state==='DRAFT'){const body=command('confirm',entry);if(!body.expectedEventId){body.expectedEventId=src.eventId;body.expectedRevisionHash=src.revisionHash;persist();}await sources.command(actor,entry.sourceId,'confirm',body);src=await sources.detail(actor,entry.sourceId);}
   if(src.state!=='REGISTERED')throw Error('Public source suspended');
   if(!entry.documentId){const body=command('prepare',entry);body.sourceId??=entry.sourceId;body.expectedSourceEventId??=src.eventId;body.expectedSourceRevisionHash??=src.revisionHash;body.metadata??={title:source.title.slice(0,155),edition:row.sourceId==='ons-procedimentos'?'Submódulo 8.1 PR · revisão 2025.06':row.sourceId==='cnpe-resolucoes'?'Resolução CNPE 8/2026 · DOU 13/05/2026':source.edition.slice(0,100),url:src.metadata.url,publishedOn:null,validFrom:null,validTo:null,provenance:('Captura HTTPS oficial em 17/11/2026. Arquivo: '+row.url+'. SHA-256 '+row.sha256+'. '+(row.sourceId==='lei-seguros'?'DOU com múltiplos atos: identificar limites da Lei 15.040; não atribuir outros atos à lei. ':'')+'Extração nativa contextual, sem declaração de revisão normativa.').slice(0,1000)};persist();entry.documentId=(await originals.prepare(actor,null,body)).documentId;persist();}
   let doc=await originals.detail(actor,entry.documentId);
   if(doc.state==='PREPARED'){const body=command('upload',entry);if(!body.expectedEventId){body.expectedEventId=doc.eventId;body.expectedRevisionHash=doc.revisionHash;body.fileHash=row.sha256;persist();}await originals.upload(actor,entry.documentId,body,{buffer:bytes,size:bytes.length,originalname:row.sourceId+'.pdf',mimetype:'application/pdf'});doc=await originals.detail(actor,entry.documentId);}
   if(doc.state!=='PRESERVED')throw Error('Storage receipt '+doc.state+'; reconcile before retrying, never resubmit blindly');
   entry.result=await indexFile(row.sourceId,entry.documentId,bytes);persist();console.log(JSON.stringify({sourceId:row.sourceId,state:'PRESERVED_CONTEXT',pages:entry.result.pageCount}));
  }catch(e){entry.error={message:e.message,code:e.code??null};persist();console.log(JSON.stringify({sourceId:row.sourceId,state:'PENDING',...entry.error}));}
 }
 // Reuse the previously preserved ANEEL original and CCEE procedures; never upload them again.
 const existing=(await originals.list(actor,{page:'0',state:'PRESERVED'})).rows;
 for(const doc of existing){
  if(/homologa|parte|lote|trecho/i.test(doc.title))continue;
  const sourceId=/1000/.test(doc.title)?'aneel1000':/1[. ,]?[68]/.test(doc.title)?'ccee-pdc':null;if(!sourceId||indexed.some(f=>f.documentId===doc.id))continue;
  try{const ref=await rpc('original',doc.id,{}),bytes=await reader.read(ref);const result=await indexFile(sourceId,doc.id,bytes);console.log(JSON.stringify({sourceId,documentId:doc.id,state:'REUSED_PRESERVED_CONTEXT',pages:result.pageCount}));}catch(e){console.log(JSON.stringify({documentId:doc.id,state:'PENDING_REUSE',message:e.message}));}
 }
 console.log(JSON.stringify({state:'LIBRARY_PRESERVATION_FINISHED',files:(await rpc('list',null,{})).length,normativeReview:'PENDING_WHERE_NOT_INDEPENDENTLY_REVIEWED'}));
})().catch(e=>{console.error({message:e.message,code:e.code??null});process.exitCode=1;});
