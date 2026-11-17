// Disposable synthetic database. No providers, storage or production data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',id=()=>crypto.randomUUID(),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
(async()=>{const db=new PGlite();let checks=0;const ok=x=>{assert(x);checks++},deny=async fn=>{await assert.rejects(fn);checks++};try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE roles(id text PRIMARY KEY);CREATE TABLE user_roles(user_id uuid,role_id text);CREATE TABLE platform_team_members(user_id uuid);INSERT INTO roles VALUES('owner');INSERT INTO user_roles VALUES('${owner}','owner');INSERT INTO platform_team_members VALUES('${owner}');CREATE FUNCTION platform_team_owner(a uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF a IS DISTINCT FROM '${owner}'::uuid THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;END$$;CREATE FUNCTION eva_product_guide_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Immutable';END$$;`);
 const migration=name=>fs.readFileSync(path.join(__dirname,'../src/database/migrations',name),'utf8');
 await db.exec(migration('20261024_eva_official_source_registry.sql'));await db.exec(migration('20261025_eva_official_originals.sql'));
 // The baseline guards are production function definitions, not weakened predicates.
 const definitions=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/legal-library-admission-baseline.json'),'utf8'));
 for(const body of Object.values(definitions))await db.exec(body);
 await db.exec(migration('20261335_legal_library_official_admission.sql'));
 await db.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);INSERT INTO auth.users(id) VALUES('${owner}'),('${other}');CREATE TABLE legal_audit_sources(id text);INSERT INTO legal_audit_sources VALUES('test-law');CREATE FUNCTION legal_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Immutable';END$$;CREATE FUNCTION legal_audit_actor(o text,a text,r text,p boolean,w boolean) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF o<>'licensed' OR a<>'${owner}' OR r<>'operator' THEN RAISE EXCEPTION 'Scoped licensed auditor required' USING ERRCODE='42501';END IF;RETURN '{}'::jsonb;END$$;`);
 await db.exec(migration('20261336_legal_library_file_context.sql'));
 const lookup=(action,key,body,a=owner,o='licensed',r='operator')=>db.query('SELECT legal_library_file_action($1,$2,$3,false,$4,$5,$6) d',[a,o,r,action,key,JSON.stringify(body)]).then(x=>x.rows[0].d);
 const source=(action,key,body,a=owner)=>db.query('SELECT eva_official_source_action($1,$2,$3,$4) d',[a,action,key,JSON.stringify(body)]).then(r=>r.rows[0].d);
 const original=(key,body,a=owner)=>db.query("SELECT eva_official_document_action($1,'prepare',$2,$3) d",[a,key,JSON.stringify(body)]).then(r=>r.rows[0].d);
 const command=()=>({requestId:id(),expectedEventId:null,expectedRevisionHash:null,justification:'Synthetic public-source admission test; no normative publication.'});
 const cases=[['PLANALTO','LEGISLATION','https://www2.camara.leg.br/legin/fed/lei/2022/law.pdf'],['PLANALTO','LEGISLATION','https://bibliotecadigital.mj.gov.br/bitstream/1/14027/2/LEI_PR_2024_15040.pdf'],['MME','MME_LEGISLATION','https://www.gov.br/mme/pt-br/law.pdf'],['CNPE','CNPE_RESOLUTIONS','https://www.gov.br/mme/pt-br/assuntos/conselhos-e-comites/cnpe/rule.pdf'],['EPE','ENERGY_PLANNING','https://www.epe.gov.br/pt/plan.pdf'],['DOU','OFFICIAL_GAZETTE','https://www.in.gov.br/publication.pdf'],['ONS','ONS_REPORTS','https://www.ons.org.br/report.pdf'],['ANEEL','ANEEL_RULES','https://www.gov.br/aneel/pt-br/rule.pdf'],['CCEE','CCEE_PROCEDURES','https://www.ccee.org.br/procedure.pdf']];
 for(const [authority,family,url] of cases){
  const metadata={title:'Synthetic '+authority,authority,family,url,markets:['COMMON'],scopeNote:'Public official source, not a reviewed norm.',cadenceDays:30};const created=await source('create',null,{...command(),metadata,metadataHash:hash(metadata)});ok(created.state==='DRAFT');
  let current=await source('detail',created.sourceId,{page:0});await source('confirm',created.sourceId,{...command(),expectedEventId:current.eventId,expectedRevisionHash:current.revisionHash});current=await source('detail',created.sourceId,{page:0});ok(current.state==='REGISTERED');
  const doc={title:'Synthetic official file',edition:'Capture for curation',url,publishedOn:null,validFrom:null,validTo:null,provenance:'Synthetic original preservation test, not normative review.'};const prepared=await original(null,{...command(),sourceId:created.sourceId,expectedSourceEventId:current.eventId,expectedSourceRevisionHash:current.revisionHash,metadata:doc,metadataHash:hash(doc)});ok(prepared.state==='PREPARED');
  await deny(()=>source('create',null,{...command(),metadata,metadataHash:hash(metadata)},other));
  if(authority==='MME'){
   const currentDoc=(await db.query("SELECT eva_official_document_action($1,'detail',$2,$3) d",[owner,prepared.documentId,JSON.stringify({page:0})])).rows[0].d;
   const reserve=(await db.query("SELECT eva_official_document_action($1,'reserve',$2,$3) d",[owner,prepared.documentId,JSON.stringify({...command(),expectedEventId:currentDoc.eventId,expectedRevisionHash:currentDoc.revisionHash,fileHash:'a'.repeat(64),size:100})])).rows[0].d;
   await db.query("SELECT eva_official_document_action($1,'finish',$2,$3)",[owner,prepared.documentId,JSON.stringify({...command(),expectedEventId:reserve.eventId,expectedRevisionHash:reserve.revisionHash,operationId:reserve.operationId,outcome:'PRESERVED',diagnostic:'VERIFIED'})]);
   const body={sourceId:'test-law',fileHash:'a'.repeat(64),pages:[{page:1,text:'Garantia financeira no contrato. Cessão de direitos deve ser conferida.'}],metadata:{capture:'synthetic public source'}};
   await deny(()=>lookup('index',prepared.documentId,{...body,fileHash:'b'.repeat(64)}));
   await deny(()=>lookup('index',prepared.documentId,body,other));
   ok((await lookup('index',prepared.documentId,body)).state==='PRESERVED_CONTEXT');ok((await lookup('index',prepared.documentId,body)).replayed===true);
   await deny(()=>lookup('index',prepared.documentId,{...body,pages:[{page:1,text:'Changed original reading'}]}));
   const found=await lookup('search',null,{query:'garantias cessão'});ok(found.length===1);ok(found[0].page===1);ok(found[0].curation==='PRESERVED_CONTEXT_NOT_NORMATIVE_REVIEW');ok(found[0].url===url);ok(!JSON.stringify(found).includes('object_key'));
   ok((await lookup('list',null,{})).length===1);await deny(()=>lookup('search',null,{query:'garantia'},other));await deny(()=>lookup('search',null,{query:'garantia'},owner,'unlicensed'));
   ok((await lookup('search',null,{query:'xyznevermentioned'})).length===0);
   await deny(()=>db.exec("UPDATE legal_library_files SET source_id='changed'"));
  }

 }
 for(const [authority,family,url] of [['MME','MME_LEGISLATION','https://www.gov.br/saude/secret.pdf'],['EPE','ENERGY_PLANNING','https://www.epe.gov.br.evil.test/file.pdf'],['PLANALTO','LEGISLATION','http://www2.camara.leg.br/law.pdf'],['DOU','OFFICIAL_GAZETTE','https://user:secret@www.in.gov.br/file.pdf'],['CNPE','CNPE_RESOLUTIONS','https://localhost.internal/private'],['EPE','MME_LEGISLATION','https://www.epe.gov.br/plan.pdf']]){
  const metadata={title:'Invalid source',authority,family,url,markets:['COMMON'],scopeNote:'Synthetic invalid admission test.',cadenceDays:30};await deny(()=>source('create',null,{...command(),metadata,metadataHash:hash(metadata)}));
 }
 const metadata={title:'Distributor declaration',authority:'DISTRIBUTOR',family:'DISTRIBUTOR_DOCUMENTS',url:'https://utility.example.test/draft',markets:['COMMON'],scopeNote:'Declaration only; may not become a public official source.',cadenceDays:30},draft=await source('create',null,{...command(),metadata,metadataHash:hash(metadata)}),current=await source('detail',draft.sourceId,{page:0});await deny(()=>source('confirm',draft.sourceId,{...command(),expectedEventId:current.eventId,expectedRevisionHash:current.revisionHash}));
 for(const role of ['anon','authenticated'])for(const fn of ['eva_official_source_action(uuid,text,uuid,jsonb)','eva_official_document_action(uuid,text,uuid,jsonb)','eva_legal_official_family(text,text)','eva_legal_official_url(text,text)'])ok((await db.query('SELECT has_function_privilege($1,$2,$3) p',[role,'public.'+fn,'EXECUTE'])).rows[0].p===false);
 console.log('Legal library admission:',checks,'checks passed; public provenance, Owner, draft and ACL guards preserved.');
 }finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where});process.exitCode=1;});
