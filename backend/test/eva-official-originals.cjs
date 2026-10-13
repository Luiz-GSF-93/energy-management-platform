// Disposable PostgreSQL only. Never loads application credentials.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let checks=0;const ok=v=>{assert.ok(v);checks++},id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE roles(id uuid,scope text,name text,organization_id text,permissions jsonb);CREATE TABLE user_roles(user_id uuid,role_id uuid);CREATE TABLE platform_team_members(user_id uuid,profile text,active boolean);CREATE TABLE user_profiles(user_id uuid);
 INSERT INTO roles VALUES('${id(11)}','global','admin_platform','${id(9)}','["82e7fc71-479a-4dd6-8b22-4fba6eaa6841"]'),('${id(12)}','global','platform_finance','${id(9)}','[]');
 INSERT INTO user_roles VALUES('${id(1)}','${id(11)}'),('${id(2)}','${id(12)}');INSERT INTO platform_team_members VALUES('${id(1)}','OWNER',true),('${id(2)}','FINANCE',true);INSERT INTO user_profiles VALUES('${id(1)}'),('${id(2)}');`);
 const root=path.resolve(__dirname,'../src/database/migrations');const team=fs.readFileSync(root+'/20261010_platform_team.sql','utf8');const begin=team.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_owner(');await db.exec(team.slice(begin,team.indexOf('END $$;',begin)+7));
 await db.exec(fs.readFileSync(root+'/20261022_eva_product_guide_publications.sql','utf8'));await db.exec(fs.readFileSync(root+'/20261023_eva_product_guide_list_aliases.sql','utf8'));await db.exec(fs.readFileSync(root+'/20261024_eva_official_source_registry.sql','utf8'));
 await db.exec(fs.readFileSync(root+'/20261025_eva_official_originals.sql','utf8'));

 const source=(actor,action,key,body)=>db.query('SELECT eva_official_source_action($1,$2,$3,$4) AS data',[actor,action,key,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const call=(actor,action,key,body)=>db.query('SELECT eva_official_document_action($1,$2,$3,$4) AS data',[actor,action,key,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const deny=async(fn,code)=>{let error;try{await fn()}catch(e){error=e}ok(error?.code===code)};
 const hash='a'.repeat(64),meta={title:'Synthetic official PDF',edition:'Test edition',url:'https://www.gov.br/aneel/pt-br/test.pdf',publishedOn:null,validFrom:null,validTo:null,provenance:'Synthetic test provenance; no imported norm or external calls.'};
 const sm={title:'Synthetic ANEEL source',authority:'ANEEL',family:'ANEEL_RULES',url:'https://www.gov.br/aneel/pt-br',markets:['COMMON'],scopeNote:'Synthetic declaration.',cadenceDays:30};
 const sc={requestId:id(20),expectedEventId:null,expectedRevisionHash:null,justification:'Synthetic source registration for isolated testing.',metadata:sm,metadataHash:hash};
 await source(id(1),'create',null,sc);let sd=await source(id(1),'detail',id(20),{page:0});
 const decision=(n,d)=>({requestId:id(n),expectedEventId:d.eventId,expectedRevisionHash:d.revisionHash,justification:'Synthetic internal decision, no normative publication.'});
 await source(id(1),'confirm',id(20),decision(21,sd));sd=await source(id(1),'detail',id(20),{page:0});
 const prep=n=>({requestId:id(n),expectedEventId:null,expectedRevisionHash:null,justification:'Synthetic private document preparation for test only.',sourceId:id(20),expectedSourceEventId:sd.eventId,expectedSourceRevisionHash:sd.revisionHash,metadata:meta,metadataHash:hash});
 const filters={page:0,search:'',state:''};
 const tables=['eva_official_documents','eva_official_document_revisions','eva_official_storage_operations','eva_official_document_events'];
 for(const t of tables){const a=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[t])).rows[0];ok(a.relrowsecurity&&a.relforcerowsecurity);for(const role of ['anon','authenticated','service_role'])for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) AS p',[role,t,priv])).rows[0].p);}
 for(const role of ['anon','authenticated'])ok(!(await db.query('SELECT has_function_privilege($1,\'eva_official_document_action(uuid,text,uuid,jsonb)\',\'EXECUTE\') AS p',[role])).rows[0].p);
 ok((await db.query('SELECT has_function_privilege(\'service_role\',\'eva_official_document_action(uuid,text,uuid,jsonb)\',\'EXECUTE\') AS p')).rows[0].p);
 await deny(()=>call(null,'list',null,filters),'42501');await deny(()=>call(id(2),'prepare',null,prep(30)),'42501');
 for(const profile of ['ADMINISTRATOR','FINANCE','SUPPORT']){await db.query('UPDATE platform_team_members SET profile=$1 WHERE user_id=$2',[profile,id(1)]);await deny(()=>call(id(1),'list',null,filters),'42501')};await db.query('UPDATE platform_team_members SET profile=\'OWNER\' WHERE user_id=$1',[id(1)]);
 ok((await call(id(1),'prepare',null,prep(30))).state==='PREPARED');ok((await call(id(1),'prepare',null,prep(30))).replayed);
 await deny(()=>call(id(1),'prepare',null,{...prep(30),metadata:{...meta,title:'Conflicting retry'}}),'23505');
 let d=await call(id(1),'detail',id(30),{page:0});ok(d.version===1&&d.documentState==='DRAFT'&&d.state==='PREPARED'&&d.metadata.validFrom===null);
 for(const patch of [{actorId:id(2)},{metadata:{...meta,scope:'PUBLIC'}},{metadataHash:'x'},{metadata:{...meta,url:'https://example.test/test.pdf'}},{metadata:{...meta,url:'http://www.gov.br/aneel/pt-br/test.pdf'}},{metadata:{...meta,validTo:'2026-01-01'}}])await deny(()=>call(id(1),'prepare',null,{...prep(31),...patch}),'22023');
 await deny(()=>call(id(1),'prepare',null,{...prep(31),expectedSourceEventId:id(20)}),'23505');
 const reserve=(n,dt)=>({...decision(n,dt),fileHash:'b'.repeat(64),size:100});
 const r=reserve(40,d);ok((await call(id(1),'reserve',id(30),r)).state==='RESERVED');ok((await call(id(1),'reserve',id(30),r)).replayed);
 d=await call(id(1),'detail',id(30),{page:0});ok(d.operationId===id(40)&&d.operations[0].file_hash==='b'.repeat(64));ok(!('object_key' in d.operations[0]));
 await deny(()=>call(id(1),'reserve',id(30),reserve(41,d)),'23505');await deny(()=>call(id(1),'reconcile',id(30),{...decision(42,d),operationId:id(40)}),'23505');
 const finish=(n,dt,operationId,outcome='PRESERVED',diagnostic='VERIFIED')=>({...decision(n,dt),operationId,outcome,diagnostic});
 await deny(()=>call(id(1),'finish',id(30),finish(43,d,id(99))),'23505');await deny(()=>call(id(1),'finish',id(30),finish(43,d,id(40),'PRESERVED','NOT_FOUND')),'23505');await deny(()=>call(id(1),'finish',id(30),finish(43,d,id(40),'FAILED','NOT_FOUND')),'23505');
 ok((await call(id(1),'finish',id(30),finish(44,d,id(40),'UNKNOWN','NETWORK_OR_HTTP'))).state==='UNKNOWN');d=await call(id(1),'detail',id(30),{page:0});await deny(()=>call(id(1),'reserve',id(30),reserve(45,d)),'23505');
 // Trusted disposable fixture models a process interruption older than the lease. No production update bypass.
 await db.query(`INSERT INTO eva_official_document_events(id,document_id,revision_id,operation_id,sequence,action,state,diagnostic,actor_id,justification,input,created_at) SELECT $1,document_id,revision_id,operation_id,sequence+1,action,state,diagnostic,actor_id,justification,input,clock_timestamp()-interval '61 seconds' FROM eva_official_document_events WHERE id=$2`,[id(46),d.eventId]);d=await call(id(1),'detail',id(30),{page:0});
 ok((await call(id(1),'reconcile',id(30),{...decision(47,d),operationId:id(40)})).state==='RECONCILING');d=await call(id(1),'detail',id(30),{page:0});ok((await call(id(1),'finish',id(30),finish(48,d,id(40)))).state==='PRESERVED');d=await call(id(1),'detail',id(30),{page:0});
 ok(d.documentState==='DRAFT');await deny(()=>call(id(1),'reserve',id(30),reserve(49,d)),'23505');await call(id(1),'revise',id(30),{...prep(50),...decision(50,d),metadata:{...meta,edition:'Second edition'},metadataHash:'c'.repeat(64)});d=await call(id(1),'detail',id(30),{page:0});ok(d.version===2&&d.state==='PREPARED'&&d.operations.length===0);ok(d.history.some(h=>h.version===1&&h.metadata.edition===meta.edition));
 const compete=await Promise.allSettled([call(id(1),'reserve',id(30),reserve(51,d)),call(id(1),'reserve',id(30),reserve(52,d))]);ok(compete.filter(x=>x.status==='fulfilled').length===1);ok(compete.filter(x=>x.status==='rejected'&&x.reason.code==='23505').length===1);
 d=await call(id(1),'detail',id(30),{page:0});await source(id(1),'suspend',id(20),decision(60,sd));
 ok((await call(id(1),'finish',id(30),finish(61,d,d.operationId))).state==='BLOCKED');d=await call(id(1),'detail',id(30),{page:0});ok(d.diagnostic==='SOURCE_CHANGED');await deny(()=>call(id(1),'prepare',null,prep(62)),'23505');await deny(()=>call(id(1),'revise',id(30),{...prep(63),...decision(63,d)}),'23505');
 sd=await source(id(1),'detail',id(20),{page:0});await source(id(1),'resume',id(20),decision(64,sd));sd=await source(id(1),'detail',id(20),{page:0});await source(id(1),'confirm',id(20),decision(65,sd));sd=await source(id(1),'detail',id(20),{page:0});
 for(let n=100;n<111;n++)await call(id(1),'prepare',null,prep(n));let first=await call(id(1),'list',null,filters),second=await call(id(1),'list',null,{...filters,page:1});ok(first.total===12&&first.rows.length===10&&second.rows.length===2);ok(new Set([...first.rows,...second.rows].map(x=>x.id)).size===12);ok((await call(id(1),'list',null,{...filters,state:'BLOCKED'})).total===1);ok((await call(id(1),'list',null,{...filters,search:'%'})).total===0);
 for(const patch of [{page:-1},{page:1001},{state:'PUBLISHED'},{actorId:id(2)}])await deny(()=>call(id(1),'list',null,{...filters,...patch}),'22023');
 for(const t of tables){await deny(()=>db.query('DELETE FROM '+t),'42501')};await deny(()=>db.query('UPDATE eva_official_document_revisions SET metadata_hash=\'forged\''),'42501');
 await db.query('UPDATE platform_team_members SET active=false WHERE user_id=$1',[id(1)]);await deny(()=>call(id(1),'list',null,filters),'42501');
 ok((await db.query('SELECT count(*) AS n FROM eva_product_guide_publications')).rows[0].n===0);
 console.log(JSON.stringify({checks,result:'PASS',tables:4,externalCalls:0}));
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
