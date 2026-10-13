// Disposable PostgreSQL (PGlite) only. No environment secrets or production connector.
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const assert=require('node:assert/strict');
let checks=0;
const ok=(condition)=>{assert.ok(condition);checks++;};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const source=readFileSync(resolve(__dirname,'../../docs/proposals/eva-knowledge-phase0.sql'),'utf8');
  ok(!source.includes('CREATE OR REPLACE'));ok(!source.includes('CREATE EXTENSION'));ok(!source.includes('GRANT '));
  await db.exec(source);
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'eva_%'")).rows;
  ok(tables.length===10);
  for(const {tablename} of tables){
   const r=(await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",[`public.${tablename}`])).rows[0];ok(r.relrowsecurity&&r.relforcerowsecurity);
   for(const role of ['anon','authenticated','service_role']){
    ok(!(await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS permitted",[role,`public.${tablename}`])).rows[0].permitted);
   }
  }
  const rejected=async(sql,params=[],code='23514')=>{let error;try{await db.query(sql,params);}catch(e){error=e;}ok(error?.code===code);};
  await db.query('INSERT INTO eva_knowledge_sources(id,source_key,kind,authority,registered_by) VALUES($1,$2,$3,$4,$5)',[id(1),'synthetic','OFFICIAL','SYNTHETIC',id(10)]);
  const document=(i,scope,org=null,customer=null,unit=null)=>db.query('INSERT INTO eva_knowledge_documents(id,source_id,document_key,scope_kind,organization_id,customer_id,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(i),id(1),`doc-${i}`,scope,org,customer,unit]);
  await document(2,'OFFICIAL_PUBLIC');
  await rejected('INSERT INTO eva_knowledge_documents(id,source_id,document_key,scope_kind,organization_id) VALUES($1,$2,$3,$4,$5)',[id(3),id(1),'private-as-public','OFFICIAL_PUBLIC',id(90)]);
  await rejected('INSERT INTO eva_knowledge_documents(id,source_id,document_key,scope_kind) VALUES($1,$2,$3,$4)',[id(3),id(1),'no-tenant','ORGANIZATION']);
  await rejected('INSERT INTO eva_knowledge_documents(id,source_id,document_key,scope_kind,organization_id) VALUES($1,$2,$3,$4,$5)',[id(3),id(1),'no-unit','CLIENT_UNIT',id(90)]);
  const review='INSERT INTO eva_knowledge_reviews(id,document_id,version,document_hash,content_hash,author_id,reviewer_id,action,justification,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
  const reviewArgs=[id(4),id(2),'v1','a'.repeat(64),'b'.repeat(64),id(10),id(11),'APPROVE','Synthetic isolated review','2026-09-01'];
  await db.query(review,reviewArgs);
  await rejected(review,[id(5),...reviewArgs.slice(1,6),id(10),...reviewArgs.slice(7)]);
  const insert='INSERT INTO eva_knowledge_revisions(id,document_id,scope_kind,version,document_hash,content_hash,status,audiences,valid_from,valid_to,published_at,review_id,product_release,section,page,required_permissions,required_modules,allowed_platform_profiles) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)';
  const args=[id(6),id(2),'OFFICIAL_PUBLIC','v1','a'.repeat(64),'b'.repeat(64),'PUBLISHED',['BACKOFFICE'],'2026-01-01',null,'2026-09-02',id(4),null,'synthetic section',1,[],[],[]];
  await db.query(insert,args);
  const change=async(i,value,code='23514')=>{const a=[...args];a[0]=id(7);a[i]=value;await rejected(insert,a,code);};
  await change(4,'x');await change(5,'c'.repeat(64));await change(11,null);await change(10,'2026-08-01');await change(9,'2025-01-01');await change(14,0);await change(7,['EVIL']);await change(12,'release');await change(7,['PLATFORM']);await change(17,['ROOT']);
  await change(0,id(6),'23505');
  await rejected('UPDATE eva_knowledge_revisions SET section=$1 WHERE id=$2',['mutated',id(6)],'55000');
  await rejected('DELETE FROM eva_knowledge_revisions WHERE id=$1',[id(6)],'55000');
  await rejected('UPDATE eva_knowledge_reviews SET justification=$1 WHERE id=$2',['changed review',id(4)],'55000');
  await document(8,'PRODUCT');
  const product=[...args];product[0]=id(9);product[1]=id(8);product[2]='PRODUCT';product[6]='DRAFT';product[10]=null;product[11]=null;product[12]='release-a';
  await rejected(insert,product); // Official source cannot become a product guide.
  await db.query('INSERT INTO eva_knowledge_sources(id,source_key,kind,authority,registered_by) VALUES($1,$2,$3,$4,$5)',[id(30),'synthetic-product','PRODUCT_GUIDE','SYNTHETIC',id(10)]);
  await db.query('INSERT INTO eva_knowledge_documents(id,source_id,document_key,scope_kind) VALUES($1,$2,$3,$4)',[id(31),id(30),'product-guide','PRODUCT']);
  product[1]=id(31);await db.query(insert,product);
  const guide='INSERT INTO eva_module_guides(id,module_key,product_release,audience,revision_id,implementation_state) VALUES($1,$2,$3,$4,$5,$6)';
  await db.query(guide,[id(32),'documents','release-a','BACKOFFICE',id(9),'IMPLEMENTED']);
  await rejected(guide,[id(33),'documents','release-b','BACKOFFICE',id(9),'IMPLEMENTED']);
  await rejected(guide,[id(33),'documents','release-a','PORTAL',id(9),'IMPLEMENTED']);
  const missingRelease=[...product];missingRelease[0]=id(34);missingRelease[12]=null;await rejected(insert,missingRelease);
  const job='INSERT INTO eva_index_jobs(id,revision_id,provider,parser_version,embedding_version,idempotency_key,cost_scope,organization_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)';
  const jobArgs=[id(20),id(6),'AZURE_SEARCH','parser-v1','embedding-v1','unique-synthetic-job','PLATFORM_CORPUS',null];
  await db.query(job,jobArgs);
  await rejected(job,[id(21),...jobArgs.slice(1)],'23505');
  const bad=[...jobArgs];bad[0]=id(21);bad[5]='bad-cost';bad[7]=id(90);await rejected(job,bad);
  await rejected(job,[id(21),id(6),'AZURE_SEARCH','parser','embedding','org-charge-for-global','ORGANIZATION',id(90)]);
  await db.query('INSERT INTO eva_knowledge_sources(id,source_key,kind,authority,registered_by) VALUES($1,$2,$3,$4,$5)',[id(40),'synthetic-private','OPERATIONAL','SYNTHETIC',id(10)]);
  await db.query('INSERT INTO eva_knowledge_documents(id,source_id,document_key,scope_kind,organization_id,customer_id,unit_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(41),id(40),'unit-evidence','CLIENT_UNIT',id(90),id(91),id(92)]);
  const scoped=[...product];scoped[0]=id(42);scoped[1]=id(41);scoped[2]='CLIENT_UNIT';scoped[12]=null;await db.query(insert,scoped);
  await db.query(job,[id(43),id(42),'AZURE_SEARCH','parser','embedding','valid-private-job','ORGANIZATION',id(90)]);
  await rejected(job,[id(44),id(42),'AZURE_SEARCH','parser','embedding','other-tenant-job','ORGANIZATION',id(99)]);
  await rejected(job,[id(44),id(42),'AZURE_SEARCH','parser','embedding','global-private-job','PLATFORM_CORPUS',null]);
  await rejected('UPDATE eva_index_jobs SET attempts=4 WHERE id=$1',[id(20)]);
  await db.exec('SET ROLE authenticated');
  await rejected('SELECT * FROM eva_knowledge_revisions',[],'42501');
  await db.exec('RESET ROLE');
  ok((await db.query("SELECT count(*) AS total FROM eva_knowledge_revisions WHERE status='PUBLISHED'")).rows[0].total===1);
  console.log(JSON.stringify({result:'PASS',checks,disposableDatabase:true,productionWrites:0,externalCalls:0}));
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
