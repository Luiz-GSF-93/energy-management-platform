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
 const call=(actor,action,source,body)=>db.query('SELECT eva_official_source_action($1,$2,$3,$4) AS data',[actor,action,source,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const deny=async(fn,code)=>{let error;try{await fn()}catch(e){error=e}ok(error?.code===code)};
 const filters={page:0,search:'',authority:'',family:'',state:''};
 const meta={title:'Synthetic ANEEL source',authority:'ANEEL',family:'PRORET',url:'https://www.gov.br/aneel/pt-br',markets:['COMMON'],scopeNote:'Declared origin only.',cadenceDays:30};
 const create={requestId:id(20),expectedEventId:null,expectedRevisionHash:null,justification:'Synthetic review of declared source metadata.',metadata:meta,metadataHash:'a'.repeat(64)};
 for(const table of ['eva_official_sources','eva_official_source_revisions','eva_official_source_events']){
  const r=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[table])).rows[0];ok(r.relrowsecurity&&r.relforcerowsecurity);
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) AS p',[role,table,privilege])).rows[0].p);
 }
 for(const role of ['anon','authenticated'])ok(!(await db.query('SELECT has_function_privilege($1,\'eva_official_source_action(uuid,text,uuid,jsonb)\',\'EXECUTE\') AS p',[role])).rows[0].p);
 ok((await db.query('SELECT has_function_privilege(\'service_role\',\'eva_official_source_action(uuid,text,uuid,jsonb)\',\'EXECUTE\') AS p')).rows[0].p);
 await deny(()=>call(null,'list',null,filters),'42501');await deny(()=>call(id(2),'list',null,filters),'42501');
 for(const profile of ['ADMINISTRATOR','FINANCE','SUPPORT']){await db.query('UPDATE platform_team_members SET profile=$1 WHERE user_id=$2',[profile,id(1)]);await deny(()=>call(id(1),'list',null,filters),'42501')};await db.query('UPDATE platform_team_members SET profile=\'OWNER\' WHERE user_id=$1',[id(1)]);
 ok((await call(id(1),'list',null,filters)).total===0);ok((await call(id(1),'create',null,create)).state==='DRAFT');ok((await call(id(1),'create',null,create)).replayed===true);
 await deny(()=>call(id(1),'create',null,{...create,justification:'Changed input for the same request identifier.'}),'23505');
 let detail=await call(id(1),'detail',id(20),{page:0});ok(detail.historyTotal===1&&detail.version===1&&detail.state==='DRAFT');
 const decision=(n,d)=>({requestId:id(n),expectedEventId:d.eventId,expectedRevisionHash:d.revisionHash,justification:'Synthetic metadata decision, no normative publication.'});
 ok((await call(id(1),'confirm',id(20),decision(21,detail))).state==='REGISTERED');await deny(()=>call(id(1),'suspend',id(20),decision(22,detail)),'23505');
 detail=await call(id(1),'detail',id(20),{page:0});ok((await call(id(1),'suspend',id(20),decision(23,detail))).state==='SUSPENDED');detail=await call(id(1),'detail',id(20),{page:0});ok((await call(id(1),'resume',id(20),decision(24,detail))).state==='DRAFT');
 detail=await call(id(1),'detail',id(20),{page:0});await call(id(1),'update',id(20),{...decision(25,detail),metadata:{...meta,title:'Synthetic revised source'},metadataHash:'b'.repeat(64)});detail=await call(id(1),'detail',id(20),{page:0});ok(detail.version===2&&detail.historyTotal===5&&detail.revisionHash==='b'.repeat(64));ok(detail.history.find(h=>h.action==='create').metadata.title===meta.title);ok(detail.history.find(h=>h.action==='create').version===1);
 ok((await db.query('SELECT metadata->>\'title\' AS title FROM eva_official_source_revisions WHERE id=$1',[id(20)])).rows[0].title===meta.title);
 const competing=await Promise.allSettled([call(id(1),'confirm',id(20),decision(26,detail)),call(id(1),'suspend',id(20),decision(27,detail))]);ok(competing.filter(x=>x.status==='fulfilled').length===1);ok(competing.filter(x=>x.status==='rejected'&&x.reason.code==='23505').length===1);
 for(const table of ['eva_official_sources','eva_official_source_revisions','eva_official_source_events']){await deny(()=>db.query('DELETE FROM '+table),'42501')};await deny(()=>db.query('UPDATE eva_official_source_revisions SET metadata_hash=\'forged\''),'42501');
 for(let n=100;n<111;n++)await call(id(1),'create',null,{...create,requestId:id(n),metadata:{...meta,title:'Source '+n}});
 const first=await call(id(1),'list',null,filters),second=await call(id(1),'list',null,{...filters,page:1});ok(first.total===12&&first.rows.length===10&&second.rows.length===2);ok(new Set([...first.rows,...second.rows].map(r=>r.id)).size===12);
 ok((await call(id(1),'list',null,{...filters,search:'Source 100'})).total===1);ok((await call(id(1),'list',null,{...filters,search:'%'})).total===0);ok((await call(id(1),'list',null,{...filters,authority:'CCEE'})).total===0);ok((await call(id(1),'list',null,{...filters,state:'DRAFT'})).total===11);
 for(const patch of [{page:-1},{page:1001},{authority:'OWNER'},{state:'PUBLISHED'},{family:'UNKNOWN'},{actorId:id(2)}])await deny(()=>call(id(1),'list',null,{...filters,...patch}),'22023');
 for(const patch of [{metadata:{...meta,authority:'CCEE'}},{metadata:{...meta,url:'https://private.internal/'}},{metadata:{...meta,url:'http://www.gov.br/aneel/'}},{metadata:{...meta,markets:[]}},{metadata:{...meta,scope:'OFFICIAL_PUBLIC'}},{metadata:{...meta,cadenceDays:0}},{actorId:id(2)},{metadataHash:'invalid'}])await deny(()=>call(id(1),'create',null,{...create,...patch,requestId:id(200)}),'22023');
 const distributor={...create,requestId:id(300),metadata:{...meta,authority:'DISTRIBUTOR',family:'DISTRIBUTOR_DOCUMENTS',url:'https://example.test/manual'}};await call(id(1),'create',null,distributor);detail=await call(id(1),'detail',id(300),{page:0});await deny(()=>call(id(1),'confirm',id(300),decision(301,detail)),'23505');
 await db.query('UPDATE platform_team_members SET active=false WHERE user_id=$1',[id(1)]);await deny(()=>call(id(1),'list',null,filters),'42501');
 ok((await db.query('SELECT count(*) AS count FROM eva_product_guide_publications')).rows[0].count===0);
 console.log(JSON.stringify({checks,result:'PASS',tables:3,externalCalls:0}));
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
