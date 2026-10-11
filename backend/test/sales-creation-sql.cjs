// Reuse audited proposal/terms fixtures exclusively in disposable PostgreSQL.
const fs=require('fs');
const prior=fs.readFileSync('test/sales-asaas-sql.cjs','utf8').match(/const cases=String.raw`([\s\S]*?)`;/)[1];
const cases=String.raw`{
await db.exec('CREATE TABLE permissions(id uuid PRIMARY KEY,code text,name text,module text,resource text,action text)');
for(const n of ['offer_document','finance_read','creation']){const sql=fs.readFileSync('src/database/migrations/20261010_platform_sales_'+n+'.sql','utf8');await db.exec(sql);await db.exec(sql);}
const run=(action,body,actor=owner)=>db.query('select platform_sales_creation_action($1,$2,$3) result',[actor,action,JSON.stringify(body)]).then(x=>x.rows[0].result);
const day=(await db.query("select to_char((now() AT TIME ZONE 'UTC')::date+7,'YYYY-MM-DD') d")).rows[0].d;
await quote(800,[],owner,2);await db.query('select transition_platform_sales_proposal($1,$2,$3,1,$4,$5)',[owner,id(801),id(800),'CHECKED','Fixture source review.']);await db.query('select transition_platform_sales_proposal($1,$2,$3,2,$4,$5)',[owner,id(802),id(800),'APPROVED_INTERNAL','Fixture source approval.']);
await store(803,0,full,owner,id(800));await review(804,1,1,'CHECKED',owner,id(800));await review(805,1,2,'APPROVED_INTERNAL',owner,id(800));
await quote(820,[],owner,2);
const body={id:id(810),proposalId:id(800),termsRevision:1,customerId:'cus_4d',dueDate:day,origin:'Authorized disposable payer fixture.',consent:true};
await reject(()=>run('prepare',body,null),'42501');await reject(()=>run('prepare',body,other),'42501');
for(const n of [40,41,42,43])await reject(()=>run('prepare',body,id(n)),'42501');
await db.query('update platform_team_members set active=false where user_id=$1',[owner]);await reject(()=>run('prepare',body),'42501');await db.query('update platform_team_members set active=true where user_id=$1',[owner]);
await reject(()=>run('prepare',{...body,proposalId:id(2)}),'P3641');await reject(()=>run('prepare',{...body,consent:false}),'22023');await reject(()=>run('prepare',{...body,dueDate:'2020-01-01'}),'22023');await reject(()=>run('prepare',{...body,termsRevision:99}),'P3610');
await reject(()=>run('prepare',{...body,proposalId:id(820)}),'P3611');
await store(830,1,full,owner,id(800));await reject(()=>run('prepare',{...body,termsRevision:2}),'P3611');
await db.query("update roles set scope='organization' where id='o'");await reject(()=>run('prepare',body),'42501');await db.query("update roles set scope='global' where id='o'");
const race=await Promise.allSettled([run('prepare',body),run('prepare',{...body,id:id(811)})]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);checks++;
assert.equal((await run('prepare',body)).replayed,true);await reject(()=>run('prepare',{...body,customerId:'cus_other'}),'P3641');
let detail=await run('read',{id:body.id});assert.equal(detail.events.length,1);assert.equal(detail.intent.parameters.value,9990);assert.equal(detail.intent.parameters_hash.length,64);assert.equal(detail.externalCallsEnabled,false);checks++;
await db.exec('ALTER TABLE user_profiles RENAME TO unavailable_profiles');await reject(()=>run('read',{id:body.id}),'42P01');await db.exec('ALTER TABLE unavailable_profiles RENAME TO user_profiles');
await reject(()=>db.query('update platform_sales_creation_intents set origin=$1 where id=$2',['changed',body.id]),'42501');await reject(()=>db.query('delete from platform_sales_creation_events'),'42501');
const concurrent=await Promise.allSettled([run('claim',{id:body.id,lease:id(812)}),run('claim',{id:body.id,lease:id(813)})]);assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);checks++;
detail=await run('read',{id:body.id});const lease=detail.events.at(-1).lease;
await reject(()=>run('claim',{id:body.id,lease:id(814)}),'P3641');await reject(()=>run('reconcile',{id:body.id,lease:id(815)}),'P3641');await reject(()=>run('finish',{id:body.id,lease:id(999),summary:null}),'P3641');
await run('finish',{id:body.id,lease,summary:null});await reject(()=>run('claim',{id:body.id,lease:id(816)}),'P3641');
await run('reconcile',{id:body.id,lease:id(817)});await run('finish',{id:body.id,lease:id(817),summary:{id:'pay_wrong',customer:'cus_4d',reference:body.id,grossCents:1,status:'PENDING'}});assert.equal((await run('read',{id:body.id})).events.at(-1).state,'RECONCILIATION');checks++;
await run('reconcile',{id:body.id,lease:id(818)});await run('finish',{id:body.id,lease:id(818),summary:{id:'pay_4d',customer:'cus_4d',reference:body.id,grossCents:999000,netCents:null,status:'PENDING'}});detail=await run('read',{id:body.id});assert.equal(detail.events.at(-1).state,'CREATED');assert.equal((await run('claim',{id:body.id,lease:id(819)})).skip,true);assert.equal((await db.query("select count(*)::int n from platform_sales_asaas_bindings where payment_id='pay_4d'")).rows[0].n,1);checks++;
assert.equal((await run('list',{page:0,search:'absent',state:''})).total,0);assert.equal((await run('list',{page:0,search:'',state:'CREATED'})).total,1);await reject(()=>run('read',{id:id(999)}),'P3640');
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>run('list',{page:0,search:'',state:''}),'42501');await reject(()=>db.query('select * from platform_sales_creation_intents'),'42501');await db.exec('RESET ROLE');}
await db.exec('SET ROLE service_role');await run('read',{id:body.id});await reject(()=>db.query('select * from platform_sales_creation_intents'),'42501');await db.exec('RESET ROLE');
assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);assert.equal((await db.query("select count(*)::int n from pg_class where relname in ('platform_sales_creation_intents','platform_sales_creation_events') and relrowsecurity")).rows[0].n,2);checks++;
console.log('4D first-cycle uniqueness, concurrency, ambiguous restart, reconciliation, append-only records and Owner isolation passed.');
}`;
const fixture=fs.readFileSync('test/sales-offer-terms-sql.cjs','utf8').replace('await db.close();console.log(',prior+'\n'+cases+'\nawait db.close();console.log(');
new Function('require',fixture)(require);
