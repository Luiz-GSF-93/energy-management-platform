// Disposable PostgreSQL only. Never loads application credentials.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let checks=0;const ok=v=>{assert.ok(v);checks++},id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE roles(id uuid,scope text,name text,organization_id text,permissions jsonb);CREATE TABLE user_roles(user_id uuid,role_id uuid);CREATE TABLE platform_team_members(user_id uuid,profile text,active boolean,first_name text,last_name text);CREATE TABLE user_profiles(user_id uuid,name text);
 INSERT INTO roles VALUES('${id(11)}','global','admin_platform','${id(9)}','["82e7fc71-479a-4dd6-8b22-4fba6eaa6841"]'),('${id(12)}','global','platform_finance','${id(9)}','[]');
 INSERT INTO user_roles VALUES('${id(1)}','${id(11)}'),('${id(2)}','${id(12)}');INSERT INTO platform_team_members VALUES('${id(1)}','OWNER',true,'Test','Owner'),('${id(2)}','FINANCE',true,'Test','Finance');INSERT INTO user_profiles VALUES('${id(1)}','Owner'),('${id(2)}','Finance');`);
 const root=path.resolve(__dirname,'../src/database/migrations');const team=fs.readFileSync(root+'/20261010_platform_team.sql','utf8');const begin=team.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_owner(');await db.exec(team.slice(begin,team.indexOf('END $$;',begin)+7));
 await db.exec(fs.readFileSync(root+'/20261022_eva_product_guide_publications.sql','utf8'));await db.exec(fs.readFileSync(root+'/20261023_eva_product_guide_list_aliases.sql','utf8'));await db.exec(fs.readFileSync(root+'/20261024_eva_official_source_registry.sql','utf8'));
 await db.exec(fs.readFileSync(root+'/20261025_eva_official_originals.sql','utf8'));
 const workflow=fs.readFileSync(root+'/20261010_platform_workflows.sql','utf8');for(const name of ['platform_workflow_actor','platform_workflow_name']){const wb=workflow.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),wd=workflow.indexOf('$$',wb),we=workflow.indexOf('$$;',wd+2);await db.exec(workflow.slice(wb,we+3));}
 await db.exec(fs.readFileSync(root+'/20261027_eva_official_extraction_curation.sql','utf8'));
 await db.query("UPDATE roles SET permissions=permissions||'[\"e23a5c98-8b68-4ed2-aef8-70a7166407e4\"]'::jsonb WHERE id=$1",[id(11)]);await db.query("UPDATE roles SET permissions='[\"699703af-10ba-43a3-8eb8-9f0d9e477498\"]' WHERE id=$1",[id(12)]);

 const source=(actor,action,key,body)=>db.query('SELECT eva_official_source_action($1,$2,$3,$4) AS data',[actor,action,key,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const call=(actor,action,key,body)=>db.query('SELECT eva_official_document_action($1,$2,$3,$4) AS data',[actor,action,key,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const deny=async(fn,code)=>{let error;try{await fn()}catch(e){error=e}assert.equal(error?.code,code,error?.message);checks++};
 const hash='a'.repeat(64),meta={title:'Synthetic official PDF',edition:'Test edition',url:'https://www.gov.br/aneel/pt-br/test.pdf',publishedOn:null,validFrom:null,validTo:null,provenance:'Synthetic test provenance; no imported norm or external calls.'};
 const sm={title:'Synthetic ANEEL source',authority:'ANEEL',family:'ANEEL_RULES',url:'https://www.gov.br/aneel/pt-br',markets:['COMMON'],scopeNote:'Synthetic declaration.',cadenceDays:30};
 const sc={requestId:id(20),expectedEventId:null,expectedRevisionHash:null,justification:'Synthetic source registration for isolated testing.',metadata:sm,metadataHash:hash};
 await source(id(1),'create',null,sc);let sd=await source(id(1),'detail',id(20),{page:0});
 const decision=(n,d)=>({requestId:id(n),expectedEventId:d.eventId,expectedRevisionHash:d.revisionHash,justification:'Synthetic internal decision, no normative publication.'});
 await source(id(1),'confirm',id(20),decision(21,sd));sd=await source(id(1),'detail',id(20),{page:0});
 const prep=n=>({requestId:id(n),expectedEventId:null,expectedRevisionHash:null,justification:'Synthetic private document preparation for test only.',sourceId:id(20),expectedSourceEventId:sd.eventId,expectedSourceRevisionHash:sd.revisionHash,metadata:meta,metadataHash:hash});
 const sha=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');
 const x=(actor,action,job,body)=>db.query('SELECT eva_official_extraction_action($1,$2,$3,$4) AS data',[actor,action,job,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const worker=(action,job=null,token=null,body={})=>db.query('SELECT eva_official_extraction_worker($1,$2,$3,$4) AS data',[action,job,token,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const metrics=actor=>db.query('SELECT eva_official_extraction_metrics($1,$2) AS data',[actor,'2026-10']).then(r=>r.rows[0].data);
 const tables=['eva_official_extraction_jobs','eva_official_extraction_job_events','eva_official_extraction_versions','eva_official_extraction_sections','eva_official_curation_events'];
 for(const t of tables){const a=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[t])).rows[0];ok(a.relrowsecurity&&a.relforcerowsecurity);for(const role of ['anon','authenticated','service_role'])for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) AS p',[role,t,priv])).rows[0].p);}
 for(const f of ['eva_official_extraction_action(uuid,text,uuid,jsonb)','eva_official_extraction_worker(text,uuid,uuid,jsonb)','eva_official_extraction_metrics(uuid,text)']){for(const role of ['anon','authenticated'])ok(!(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS p',[role,f])).rows[0].p);ok((await db.query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') AS p',[f])).rows[0].p)}
 for(const role of ['anon','authenticated','service_role'])ok(!(await db.query('SELECT has_function_privilege($1,\'eva_extraction_origin(uuid,boolean)\',\'EXECUTE\') AS p',[role])).rows[0].p);
 const filters={page:0,search:'',state:''};await deny(()=>x(null,'list',null,filters),'42501');await deny(()=>x(id(2),'list',null,filters),'42501');
 for(const profile of ['ADMINISTRATOR','FINANCE','SUPPORT']){await db.query('UPDATE platform_team_members SET profile=$1 WHERE user_id=$2',[profile,id(1)]);await deny(()=>x(id(1),'list',null,filters),'42501')};await db.query('UPDATE platform_team_members SET profile=\'OWNER\' WHERE user_id=$1',[id(1)]);
 await deny(()=>x(id(1),'list',null,{...filters,organizationId:id(9)}),'22023');await deny(()=>x(id(1),'list',null,{...filters,page:-1}),'22023');
 async function original(n,synthetic=false){const m={...meta,title:synthetic?'HOMOLOGACAO SINTETICA - NAO E NORMA':'Authority text fixture',provenance:synthetic?'Synthetic test provenance; never a normative source.':'Disposable PostgreSQL fixture only; no external source imported.'};await call(id(1),'prepare',null,{...prep(n),metadata:m});let d=await call(id(1),'detail',id(n),{page:0});await call(id(1),'reserve',id(n),{...decision(n+100,d),fileHash:'b'.repeat(64),size:100});d=await call(id(1),'detail',id(n),{page:0});await call(id(1),'finish',id(n),{...decision(n+200,d),operationId:id(n+100),outcome:'PRESERVED',diagnostic:'VERIFIED'});return call(id(1),'detail',id(n),{page:0})}
 const prepare=(n,d,testOnly=false)=>({requestId:id(n),justification:'Disposable private extraction fixture; no provider calls.',documentId:d.id,expectedEventId:d.eventId,expectedRevisionHash:d.revisionHash,operationId:d.operationId,testOnly});
 const detail=job=>x(id(1),'detail',job,{page:0,sectionPage:0});
 const text='Art. 1 Literal preserved content',section={page:1,start:0,end:text.length,heading:'Art. 1',text,hash:sha(text),issues:[]};
 const result=(sections=[section],pageCount=1,ocrRequired=false)=>{const r={pageCount,sections,ocrRequired};return {...r,contentHash:sha(JSON.stringify(r)),durationMs:12}};
 await db.exec(fs.readFileSync(root+'/20261028_eva_search_preparation.sql','utf8'));
 await db.exec(fs.readFileSync(root+'/20261029_eva_search_document_order.sql','utf8'));
 const beforeTables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename);
 await db.exec(fs.readFileSync(root+'/20261106_eva_document_parts.sql','utf8'));
 const afterTables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename);
 assert.deepEqual(afterTables.filter(x=>!beforeTables.includes(x)),['eva_official_document_part_sets','eva_official_document_parts']);checks++;
 await db.query("INSERT INTO user_roles VALUES($1,$2)",[id(3),id(11)]);await db.query("INSERT INTO platform_team_members VALUES($1,'OWNER',true,'Other','Owner')",[id(3)]);
 await db.query('INSERT INTO user_profiles VALUES($1,$2)',[id(3),'Other Owner']);
 const pc=(actor,action,key,body)=>db.query('SELECT eva_document_parts_action($1,$2,$3,$4) AS data',[actor,action,key,JSON.stringify(body)]).then(r=>r.rows[0].data);
 for(const t of ['eva_official_document_part_sets','eva_official_document_parts']){
  const flags=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[t])).rows[0];ok(flags.relrowsecurity&&flags.relforcerowsecurity);
  for(const role of ['anon','authenticated','service_role'])for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) AS p',[role,t,priv])).rows[0].p);
 }
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_document_parts_action(uuid,text,uuid,jsonb)','EXECUTE') AS p",[role])).rows[0].p);
 for(const role of ['anon','authenticated','service_role'])for(const fn of ['eva_document_parts_origin(uuid,boolean)','eva_document_parts_search_guard()'])ok(!(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS p',[role,fn])).rows[0].p);
 const originalParent=await original(20000,false);
 const m={version:'pdf-lib-1.17.1-parts-v1',originalFileHash:'b'.repeat(64),originalPageCount:101,parts:[[1,40,'c'],[41,80,'d'],[81,101,'e']].map(([a,b,h],i)=>({ordinal:i+1,startPage:a,endPage:b,pageCount:b-a+1,fileHash:h.repeat(64),size:100,pageTextHashes:Array(b-a+1).fill('f'.repeat(64))}))};
 const pb={requestId:id(21000),documentId:originalParent.id,expectedEventId:originalParent.eventId,expectedRevisionHash:originalParent.revisionHash,operationId:originalParent.operationId,justification:'Synthetic long-document preparation in disposable database.'};
 await deny(()=>pc(id(2),'list',null,{page:0,search:'',state:''}),'42501');await deny(()=>pc(id(1),'list',null,{page:0,search:'',state:'',organizationId:'x'}),'22023');
 ok((await pc(id(1),'original',null,pb)).fileHash===m.originalFileHash);
 for(const kind of ['gap','overlap','missing','duplicate','count','null','wrongOrigin','schema']){
  const bad=JSON.parse(JSON.stringify(m));if(kind==='gap')bad.parts[1].startPage++;if(kind==='overlap')bad.parts[1].startPage--;if(kind==='missing')bad.parts.pop();if(kind==='duplicate')bad.parts[1].fileHash=bad.parts[0].fileHash;if(kind==='count')bad.originalPageCount=110;if(kind==='null')bad.parts[1].ordinal=null;if(kind==='wrongOrigin')bad.originalFileHash='a'.repeat(64);if(kind==='schema')bad.extra='x';
  await deny(()=>pc(id(1),'prepare',null,{...pb,manifest:bad}),kind==='duplicate'?'23505':'22023');
 }
 ok((await pc(id(1),'prepare',null,{...pb,manifest:m})).state==='DRAFT');ok((await pc(id(1),'prepare',null,{...pb,manifest:m})).replayed);
 await deny(()=>pc(id(3),'prepare',null,{...pb,manifest:m}),'23505');await deny(()=>pc(id(1),'prepare',null,{...pb,requestId:id(21001),manifest:m}),'23505');
 let partSet=await pc(id(1),'detail',pb.requestId,{page:0});ok(partSet.parts.length===3&&partSet.originalPages===101&&partSet.originCurrent&&!partSet.readyForSearch&&partSet.historyTotal===1);
 ok((await pc(id(1),'list',null,{page:0,search:'Authority',state:'DRAFT'})).total===1);ok((await pc(id(1),'list',null,{page:1,search:'',state:''})).rows.length===0);
 const pd=(n,s)=>({requestId:id(n),expectedSetId:s.id,justification:'Independent synthetic long-document decision, no publication.'});
 await deny(()=>pc(id(1),'review',partSet.id,pd(22000,partSet)),'42501');await deny(()=>pc(id(3),'review',partSet.id,pd(22000,partSet)),'23505');
 const command=(n,d)=>({requestId:id(n),justification:'Versioned synthetic part review; no publication or external calls.',expectedCurationEventId:d.curationEventId,expectedVersionId:d.versionId,expectedContentHash:d.contentHash});
 const correct=(n,d,patches,metadata)=>({...command(n,d),patches,metadata,contentHash:sha('curation-'+n)});
 async function derived(n,h,count){
  await call(id(1),'prepare',null,{...prep(n),metadata:{...meta,title:'Authority part fixture',provenance:'Disposable PostgreSQL fixture only; no imported original.'}});let d=await call(id(1),'detail',id(n),{page:0});await call(id(1),'reserve',d.id,{...decision(n+100,d),fileHash:h.repeat(64),size:100});d=await call(id(1),'detail',d.id,{page:0});await call(id(1),'finish',d.id,{...decision(n+200,d),operationId:id(n+100),outcome:'PRESERVED',diagnostic:'VERIFIED'});d=await call(id(1),'detail',d.id,{page:0});
  await x(id(1),'prepare',null,prepare(n+300,d));const lease=await worker('claim');assert.equal(lease.id,id(n+300));
  const sections=Array.from({length:count},(_,i)=>({...section,page:i+1}));await worker('complete',lease.id,lease.token,result(sections,count));d=await detail(lease.id);
  await x(id(1),'correct',d.id,correct(n+400,d,[],{publishedOn:'2026-01-01',validFrom:'2026-01-01',validTo:null,topic:'Synthetic part',references:['https://www.gov.br/aneel/pt-br/test.pdf']}));d=await detail(lease.id);await x(id(1),'review',d.id,{...command(n+500,d),acknowledgedPages:Array.from({length:count},(_,i)=>i+1)});return detail(lease.id);
 }
 const jobs=[];for(const [i,h,count] of [[1,'c',40],[2,'d',40],[3,'e',21]]){
  const d=await derived(30000+i*1000,h,count);jobs.push(d);
  const link={...pd(40000+i,partSet),ordinal:i,jobId:d.id,expectedVersionId:d.versionId,expectedContentHash:d.contentHash};
  await deny(()=>pc(id(1),'link',partSet.id,{...link,expectedContentHash:'0'.repeat(64)}),'23505');
  const previous=partSet.id;const linked=await pc(id(1),'link',partSet.id,link);ok(linked.state==='DRAFT');ok((await pc(id(1),'link',previous,link)).replayed);partSet=await pc(id(1),'detail',linked.id,{page:0});ok(partSet.parts[i-1].jobId===d.id);
  await deny(()=>pc(id(1),'quarantine',previous,{...pd(41000+i,partSet),expectedSetId:previous}),'23505');
 }
 ok((await pc(id(1),'download',partSet.id,{})).manifest.originalPageCount===101);
 await deny(()=>db.query("INSERT INTO eva_search_releases(id,job_id,version_id,review_event_id,manifest,manifest_hash,actor_id,input) SELECT $1,$2,$3,c.id,'{}',$4,$5,'{}' FROM eva_official_curation_events c WHERE job_id=$2 ORDER BY sequence DESC LIMIT 1",[id(45000),jobs[0].id,jobs[0].versionId,'a'.repeat(64),id(1)]),'23505');
 const reviewed=await pc(id(3),'review',partSet.id,pd(46000,partSet));ok(reviewed.state==='REVIEWED_PRIVATE'&&!reviewed.readyForSearch);partSet=await pc(id(1),'detail',reviewed.id,{page:0});ok(partSet.revision===5&&partSet.historyTotal===5);
 const races=await Promise.allSettled([pc(id(3),'review',partSet.id,pd(46500,partSet)),pc(id(3),'review',partSet.id,pd(46501,partSet))]);ok(races.filter(r=>r.status==='fulfilled').length===1);ok(races.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length===1);partSet=await pc(id(1),'detail',races.find(r=>r.status==='fulfilled').value.id,{page:0});
 // A later curation revision invalidates review, never silently updates the linked proof.
 const job=jobs[0];await x(id(1),'quarantine',job.id,command(47000,job));await deny(()=>pc(id(3),'review',partSet.id,pd(47001,partSet)),'23505');ok(!(await pc(id(1),'detail',partSet.id,{page:0})).parts[0].curationCurrent);
 await source(id(1),'suspend',id(20),decision(48000,sd));ok(!(await pc(id(1),'detail',partSet.id,{page:0})).originCurrent);await deny(()=>pc(id(1),'download',partSet.id,{}),'23505');
 const quarantined=await pc(id(1),'quarantine',partSet.id,pd(49000,partSet));ok(quarantined.state==='QUARANTINED');await deny(()=>pc(id(1),'link',quarantined.id,{...pd(49001,{id:quarantined.id}),ordinal:1,jobId:job.id,expectedVersionId:job.versionId,expectedContentHash:job.contentHash}),'23505');
 await db.query('UPDATE platform_team_members SET active=false WHERE user_id=$1',[id(1)]);await deny(()=>pc(id(1),'detail',quarantined.id,{page:0}),'42501');
 for(const t of ['eva_official_document_part_sets','eva_official_document_parts']){await deny(()=>db.query('DELETE FROM '+t),'42501');await deny(()=>db.query('UPDATE '+t+' SET '+(t.endsWith('_sets')?'id=id':'ordinal=ordinal')),'42501');}
 ok((await db.query('SELECT count(*) AS n FROM eva_search_releases')).rows[0].n===0);
 console.log(JSON.stringify({checks,result:'PASS',newTables:2,externalCalls:0}));
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
