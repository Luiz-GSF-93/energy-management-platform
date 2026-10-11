// Reuse existing disposable fixtures. Never connect to a production database.
const fs=require('fs');
const prior=fs.readFileSync('test/sales-asaas-sql.cjs','utf8').match(/^const cases=String.raw`([\s\S]*?)`;/m)[1];
const cases=String.raw`{
await db.exec('CREATE TABLE permissions(id uuid PRIMARY KEY,code text,name text,module text,resource text,action text)');
for(const n of ['offer_document','finance_read','creation','creation_recovery'])await db.exec(fs.readFileSync('src/database/migrations/20261010_platform_sales_'+n+'.sql','utf8'));
const migration=fs.readFileSync('src/database/migrations/20261011_platform_sales_recurrence_preparation.sql','utf8');await db.exec(migration);await db.exec(migration);
const recurrence=(action,body,actor=owner)=>db.query('select platform_sales_recurrence_action($1,$2,$3) result',[actor,action,JSON.stringify(body)]).then(x=>x.rows[0].result);
const creation=(action,body)=>db.query('select platform_sales_creation_action($1,$2,$3) result',[owner,action,JSON.stringify(body)]).then(x=>x.rows[0].result);
// Fee is present in the first bill but must never be repeated in the recurring value.
await save(910,{...d,monthlyCents:85000,extras:[{code:'setup',label:'Setup',recurrence:'ONCE',cents:50000}]},2,owner,2);
await quote(911,['setup'],owner,3);
await db.query('select transition_platform_sales_proposal($1,$2,$3,1,$4,$5)',[owner,id(912),id(911),'CHECKED','Fixture review.']);await db.query('select transition_platform_sales_proposal($1,$2,$3,2,$4,$5)',[owner,id(913),id(911),'APPROVED_INTERNAL','Fixture approval.']);
await store(914,0,full,owner,id(911));await review(915,1,1,'CHECKED',owner,id(911));await review(916,1,2,'APPROVED_INTERNAL',owner,id(911));
await db.query('update user_profiles set full_name=$1 where user_id=$2',['Fixture Owner',owner]);
const day=(await db.query("select ((now() AT TIME ZONE 'UTC')::date+7)::text d")).rows[0].d;
const next='2030-01-31';
const first={id:id(917),proposalId:id(911),termsRevision:1,customerId:'cus_recurrence',dueDate:day,origin:'Authorized disposable sandbox payer.',consent:true};
await creation('prepare',first);
const b={id:id(920),intentId:first.id,nextDueDate:next,justification:'Fixture preserved source and next cycle review.'};
await reject(()=>recurrence('prepare',b),'P3661');
await creation('claim',{id:first.id,lease:id(918)});await creation('reserve_post',{id:first.id,lease:id(918)});await creation('finish',{id:first.id,lease:id(918),summary:{id:'pay_recurrence',customer:first.customerId,reference:first.id,grossCents:135000,status:'PENDING'}});
for(const actor of [null,other,id(40),id(41),id(42),id(43)])await reject(()=>recurrence('prepare',b,actor),'42501');
await reject(()=>recurrence('prepare',{...b,nextDueDate:day}),'22023');await reject(()=>recurrence('prepare',{...b,nextDueDate:'2099-99-01'}),'22008');await reject(()=>recurrence('prepare',{...b,value:1}),'22023');
const race=await Promise.allSettled([recurrence('prepare',b),recurrence('prepare',{...b,id:id(921)})]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);checks++;
assert.equal((await recurrence('prepare',b)).replayed,true);await reject(()=>recurrence('prepare',{...b,justification:'Changed preserved fixture justification.'}),'P3661');
let detail=await recurrence('read',{id:b.id});assert.equal(detail.agreement.recurring_cents,'85000');assert.equal(detail.agreement.parameters.value,850);assert.equal(detail.agreement.parameters.cycle,'MONTHLY');assert.equal(detail.cycles.length,12);assert.equal(detail.cycles[0].sequence,2);assert.equal(detail.cycles[0].due_date,next);assert.equal(detail.cycles[1].due_date,'2030-02-28');assert.equal(detail.cycles[2].due_date,'2030-03-31');assert.equal(detail.externalCallsEnabled,false);checks++;
assert.equal((await recurrence('list',{page:0,search:'absent',state:''})).total,0);assert.equal((await recurrence('list',{page:0,search:'cus_recurrence',state:'PREPARED'})).total,1);checks++;
const check={id:b.id,requestId:id(922),expectedVersion:1,status:'CHECKED',justification:'Fixture reviewed all preserved billing cycles.'};
await reject(()=>recurrence('review',{...check,status:'APPROVED_INTERNAL'}),'P3661');
const reviews=await Promise.allSettled([recurrence('review',check),recurrence('review',{...check,requestId:id(923)})]);assert.equal(reviews.filter(x=>x.status==='fulfilled').length,1);checks++;
assert.equal((await recurrence('review',check)).replayed,true);await reject(()=>recurrence('review',{...check,justification:'Different review justification fixture.'}),'P3661');
await recurrence('review',{...check,requestId:id(924),expectedVersion:2,status:'APPROVED_INTERNAL'});
await db.query('update user_profiles set full_name=$1 where user_id=$2',['Renamed Owner',owner]);detail=await recurrence('read',{id:b.id});assert.equal(detail.events[0].actor_name,'Fixture Owner');assert.equal(detail.events[0].current_actor_name,'Renamed Owner');assert.equal(detail.agreement.actor_id,owner);checks++;
const finance=id(930);await db.query("insert into roles values('finance','global','platform_finance','platform',$1)",[JSON.stringify(['c767190a-5ec0-4d89-8675-688415e967b1'])]);await db.query("insert into user_roles values($1,'finance')",[finance]);await db.query("insert into platform_team_members values($1,true,'FINANCE')",[finance]);
detail=await recurrence('read',{id:b.id},finance);assert.equal(detail.agreement.current_actor_name,'Renamed Owner');await reject(()=>recurrence('review',{...check,requestId:id(931)},finance),'42501');checks++;
await db.exec('ALTER TABLE user_profiles RENAME TO profiles_unavailable');detail=await recurrence('read',{id:b.id},finance);assert.equal(detail.events[0].current_actor_name,null);assert.equal(detail.events[0].actor_name,'Fixture Owner');await reject(()=>recurrence('prepare',b),'42P01');await db.exec('ALTER TABLE profiles_unavailable RENAME TO user_profiles');checks++;
for(const table of ['platform_sales_billing_agreements','platform_sales_billing_cycles','platform_sales_billing_events']){await reject(()=>db.query('delete from '+table),'42501');for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await reject(()=>db.query('select * from '+table),'42501');await db.exec('RESET ROLE');}}
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>recurrence('list',{page:0,search:'',state:''}),'42501');await db.exec('RESET ROLE');}
await db.exec('SET ROLE service_role');await recurrence('read',{id:b.id});await db.exec('RESET ROLE');
await db.query('select create_platform_sales_proposal($1,$2,$3,$4,$5,$6,$7,$8)',[owner,id(940),receipt,plan,3,'ANNUAL',JSON.stringify(['setup']),'Annual fixture review.']);
await db.query('select transition_platform_sales_proposal($1,$2,$3,1,$4,$5)',[owner,id(941),id(940),'CHECKED','Annual fixture source review.']);await db.query('select transition_platform_sales_proposal($1,$2,$3,2,$4,$5)',[owner,id(942),id(940),'APPROVED_INTERNAL','Annual fixture source approval.']);
await store(943,0,full,owner,id(940));await review(944,1,1,'CHECKED',owner,id(940));await review(945,1,2,'APPROVED_INTERNAL',owner,id(940));
const annualFirst={...first,id:id(946),proposalId:id(940)};await creation('prepare',annualFirst);await creation('claim',{id:annualFirst.id,lease:id(947)});await creation('reserve_post',{id:annualFirst.id,lease:id(947)});await creation('finish',{id:annualFirst.id,lease:id(947),summary:{id:'pay_annual',customer:first.customerId,reference:annualFirst.id,grossCents:1070000,status:'PENDING'}});
const annualBody={...b,id:id(948),intentId:annualFirst.id};await reject(()=>recurrence('prepare',{...annualBody,nextDueDate:day}),'22023');await recurrence('prepare',annualBody);const annual=await recurrence('read',{id:annualBody.id});assert.equal(annual.agreement.parameters.cycle,'YEARLY');assert.equal(annual.agreement.recurring_cents,'1020000');assert.equal(annual.cycles.length,1);checks++;
assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);assert.equal((await db.query("select count(*)::int n from pg_class where relname in ('platform_sales_billing_agreements','platform_sales_billing_cycles','platform_sales_billing_events') and relrowsecurity")).rows[0].n,3);checks++;

await db.exec(fs.readFileSync('src/database/migrations/20261011_platform_sales_subscription_commands.sql','utf8'));
await db.exec(fs.readFileSync('src/database/migrations/20261011_platform_sales_subscription_commands.sql','utf8'));
await db.exec(fs.readFileSync('src/database/migrations/20261011_platform_sales_subscription_preview_bound.sql','utf8'));
const command=(action,body,actor=owner)=>db.query('select platform_sales_subscription_command_action($1,$2,$3) result',[actor,action,JSON.stringify(body)]).then(x=>x.rows[0].result);
const cb={id:id(970),agreementId:b.id,justification:'Fixture approved recurrence command preparation.'};
await reject(()=>command('prepare',{...cb,agreementId:annualBody.id}),'P3671');
for(const actor of [finance,other,id(40),id(41),id(42),id(43),null])await reject(()=>command('prepare',cb,actor),'42501');
const commands=await Promise.allSettled([command('prepare',cb),command('prepare',{...cb,id:id(971)})]);assert.equal(commands.filter(x=>x.status==='fulfilled').length,1);checks++;
assert.equal((await command('prepare',cb)).replayed,true);await reject(()=>command('prepare',{...cb,justification:'Changed fixture justification text.'}),'P3671');
await reject(()=>command('prepare',{...cb,value:1}),'22023');
const sd=await command('read',{agreementId:b.id},finance);assert.equal(sd.command.parameters.value,850);assert.equal(sd.command.parameters.endDate,'2030-12-31');assert.equal(sd.command.actor_id,owner);assert.equal(sd.externalCallsEnabled,false);checks++;
const proof={customer:'cus_recurrence',reference:b.id,notificationDisabled:true,totalCount:0,hasMore:false,checkedAt:new Date().toISOString()};
const reserved={agreementId:b.id,requestId:id(972),evidence:proof,justification:'Fixture durable reservation before one POST.'};
await reject(()=>command('reserve',{...reserved,evidence:{...proof,notificationDisabled:false}}),'P3671');
await reject(()=>command('reserve',{...reserved,evidence:{...proof,checkedAt:null}}),'P3671');
await reject(()=>command('reserve',{...reserved,evidence:{...proof,checkedAt:'2000-01-01'}}),'P3671');
const dispatch=await Promise.allSettled([command('reserve',reserved),command('reserve',{...reserved,requestId:id(973)})]);assert.equal(dispatch.filter(x=>x.status==='fulfilled').length,1);checks++;
await reject(()=>command('reserve',reserved),'P3671');
assert.equal((await command('authorize',{agreementId:b.id})).state,'POST_RESERVED');checks++;
await command('ambiguous',{agreementId:b.id,requestId:id(974),evidence:{},justification:'Fixture uncertainty after reserved POST.'});
const result={id:'sub_fixture',customer:'cus_recurrence',reference:b.id,grossCents:85000,cycle:'MONTHLY',billingType:'BOLETO',nextDueDate:next,endDate:'2035-12-31',status:'ACTIVE',deleted:false};
result.endDate=sd.command.parameters.endDate;
const finish={agreementId:b.id,requestId:id(975),evidence:result,justification:'Fixture exact subscription match by GET.'};
await reject(()=>command('finish',finish),'P3671');
await reject(()=>command('reconcile',{...finish,evidence:{...result,grossCents:1}}),'P3671');
await reject(()=>command('reconcile',{...finish,evidence:{...result,reference:annualBody.id}}),'P3671');
await command('reconcile',finish);assert.equal((await command('read',{agreementId:b.id},finance)).events.at(-1).state,'CREATED');checks++;
await reject(()=>command('reconcile',finish),'P3671');
await db.exec('ALTER TABLE user_profiles RENAME TO profiles_unavailable');const unnamed=await command('read',{agreementId:b.id},finance);assert.equal(unnamed.events[0].current_actor_name,null);assert.equal(unnamed.events[0].actor_name,'Renamed Owner');await db.exec('ALTER TABLE profiles_unavailable RENAME TO user_profiles');checks++;
for(const table of ['platform_sales_subscription_commands','platform_sales_subscription_command_events']){await reject(()=>db.query('delete from '+table),'42501');for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await reject(()=>db.query('select * from '+table),'42501');await db.exec('RESET ROLE');}}
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>command('read',{agreementId:b.id}),'42501');await db.exec('RESET ROLE');}
assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);checks++;
await db.exec(fs.readFileSync('src/database/migrations/20261011_platform_sales_recurring_checks.sql','utf8'));
await db.exec(fs.readFileSync('src/database/migrations/20261011_platform_sales_recurring_checks.sql','utf8'));
const cycle=(action,body,actor=owner)=>db.query('select platform_sales_cycle_action($1,$2,$3) result',[actor,action,JSON.stringify(body)]).then(x=>x.rows[0].result);
const inbox=await db.query("insert into platform_sales_asaas_inbox(id,provider_id,event,payment_id,summary,hash) values($1,'evt_cycle','PAYMENT_CREATED','pay_cycle',$2,repeat('a',64)) returning id",[id(980),JSON.stringify({id:'pay_cycle',customer:'cus_recurrence',reference:b.id,grossCents:85000,status:'PENDING',netCents:84901})]);
const cy={id:id(981),agreementId:b.id,sequence:2,eventId:inbox.rows[0].id,lease:id(982),justification:'Fixture verified recurring cycle association.'};
for(const actor of [finance,other,id(40),id(41),null])await reject(()=>cycle('claim',cy,actor),'42501');
await reject(()=>cycle('claim',{...cy,sequence:0}),'P3681');
const claimed=await Promise.allSettled([cycle('claim',cy),cycle('claim',{...cy,lease:id(983)})]);assert.equal(claimed.filter(x=>x.status==='fulfilled').length,1);checks++;
assert.equal((await db.query('select count(*)::int n from platform_sales_cycle_bindings')).rows[0].n,0);checks++;
const verified={id:'pay_cycle',customer:'cus_recurrence',reference:b.id,subscription:'sub_fixture',dueDate:next,grossCents:85000,netCents:84901,status:'PENDING'};
await cycle('finish',{lease:cy.lease,summary:{...verified,dueDate:'2030-02-02'}});
assert.equal((await db.query('select count(*)::int n from platform_sales_cycle_bindings')).rows[0].n,0);checks++;
await cycle('claim',{...cy,lease:id(984)});assert.equal((await cycle('finish',{lease:id(984),summary:verified})).status,'VERIFIED');
assert.equal((await cycle('finish',{lease:id(984),summary:verified})).replayed,true);await reject(()=>cycle('finish',{lease:id(984),summary:{...verified,grossCents:1}}),'P3681');
const readCycles=()=>cycle('read',{agreementId:b.id,page:0,search:'',state:''},finance);
let cd=await readCycles();assert.equal(cd.rows.length,1);assert.equal(cd.rows[0].state,'PENDING');assert.equal(cd.totals.receivedGrossCents,'0');checks++;
await cycle('claim',{...cy,lease:id(985)});await cycle('finish',{lease:id(985),summary:{...verified,status:'RECEIVED'}});cd=await readCycles();assert.equal(cd.totals.receivedGrossCents,'85000');assert.equal(cd.totals.receivedKnownNetCents,'84901');checks++;
await db.exec(fs.readFileSync('src/database/migrations/20261011_platform_sales_finance_consolidated.sql','utf8'));
await db.exec(fs.readFileSync('src/database/migrations/20261011_platform_sales_financial_evidence.sql','utf8'));
await db.exec(fs.readFileSync('src/database/migrations/20261011_platform_sales_financial_evidence.sql','utf8'));
const ev=(action,body,actor=owner)=>db.query('select platform_sales_evidence_action($1,$2,$3) result',[actor,action,JSON.stringify(body)]).then(x=>x.rows[0].result);
const onceBinding=(await db.query("select * from platform_sales_asaas_bindings where payment_id='pay_recurrence'")).rows[0];
const onceSummary={id:onceBinding.payment_id,customer:onceBinding.customer_id,reference:onceBinding.id,grossCents:Number(onceBinding.gross_cents),netCents:134901,status:'RECEIVED'};
await db.query("insert into platform_sales_asaas_inbox(id,provider_id,event,payment_id,summary,hash) values($1,'evt_evidence_once','PAYMENT_RECEIVED',$2,$3,repeat('c',64))",[id(1180),onceBinding.payment_id,JSON.stringify(onceSummary)]);
await db.query("insert into platform_sales_asaas_checks(id,event_id,version,status,lease,actor_id,note,summary) values($1,$2,1,'VERIFIED',$3,$4,'Fixture preserved check',$5)",[id(1181),id(1180),id(1182),owner,JSON.stringify(onceSummary)]);
const beforeOnce=await db.query('select read_platform_sales_finance_consolidated($1,0,$2,$2,NULL,NULL,false,NULL) result',[finance,'']);
await ev('claim',{kind:'ONCE',id:onceBinding.id,lease:id(1183),justification:'Fixture one-off evidence verification.'});
assert.equal((await ev('finish',{lease:id(1183),evidence:{payment:onceSummary,refunds:[],invoices:[],refundsComplete:true,invoicesComplete:true}})).status,'COMPLETE');checks++;
assert.equal((await ev('read',{kind:'ONCE',id:onceBinding.id,page:0},finance)).rows.length,1);checks++;
const afterOnce=await db.query('select read_platform_sales_finance_consolidated($1,0,$2,$2,NULL,NULL,false,NULL) result',[finance,'']);assert.deepEqual(afterOnce.rows[0].result.totals,beforeOnce.rows[0].result.totals);checks++;
const eb={kind:'CYCLE',id:cy.id,lease:id(1100),justification:'Fixture isolated evidence review.'};
for(const actor of [finance,other,id(40),id(41),null])await reject(()=>ev('claim',eb,actor),'42501');
await reject(()=>ev('read',{...eb,page:0},other),'42501');
await reject(()=>ev('read',{kind:'OTHER',id:cy.id,page:0}),'22023');
await reject(()=>ev('read',{kind:'CYCLE',id:id(1199),page:0}),'P3690');
const priorCycles=await readCycles();
const claimedEvidence=await Promise.allSettled([ev('claim',eb),ev('claim',{...eb,lease:id(1101)})]);assert.equal(claimedEvidence.filter(x=>x.status==='fulfilled').length,1);checks++;
const er={payment:{...verified,status:'RECEIVED'},refunds:[{status:'DONE',valueCents:100,date:'2030-01-20'},{status:'PENDING',valueCents:200,date:'2030-01-20'},{status:'CANCELLED',valueCents:300,date:'2030-01-20'}],refundsComplete:true,invoicesComplete:true,invoices:[{id:'inv_fixture',payment:'pay_cycle',customer:'cus_recurrence',status:'AUTHORIZED',valueCents:85000,effectiveDate:'2030-01-20'}]};
await reject(()=>ev('finish',{lease:eb.lease,evidence:er},finance),'42501');
assert.equal((await ev('finish',{lease:eb.lease,evidence:er})).status,'COMPLETE');checks++;
assert.equal((await ev('finish',{lease:eb.lease,evidence:er})).replayed,true);checks++;
await reject(()=>ev('finish',{lease:eb.lease,evidence:{...er,refunds:[]}}),'P3691');
let ed=await ev('read',{kind:'CYCLE',id:cy.id,page:0},finance);assert.equal(ed.canCheck,false);assert.equal(ed.rows.length,1);assert.equal(ed.rows[0].evidence.refunds.length,3);checks++;
assert.equal((await ev('read',{kind:'CYCLE',id:cy.id,page:0})).canCheck,true);checks++;
assert.deepEqual((await readCycles()).totals,priorCycles.totals);checks++;
await db.query('update user_profiles set full_name=$1 where user_id=$2',['New Owner Name',owner]);ed=await ev('read',{kind:'CYCLE',id:cy.id,page:0},finance);assert.notEqual(ed.rows[0].actor_name,ed.rows[0].current_actor_name);assert.equal(ed.rows[0].actor_id,owner);checks++;
await db.exec('ALTER TABLE user_profiles RENAME TO profiles_unavailable');ed=await ev('read',{kind:'CYCLE',id:cy.id,page:0},finance);assert.equal(ed.rows[0].current_actor_name,null);assert.ok(ed.rows[0].actor_name);await db.exec('ALTER TABLE profiles_unavailable RENAME TO user_profiles');checks++;
for(const [offset,evidence,status] of [[2,{...er,refunds:[],refundsComplete:false},'PARTIAL'],[3,{...er,invoices:[],invoicesComplete:false},'PARTIAL'],[4,null,'REVIEW'],[5,{...er,payment:{...er.payment,customer:'cus_wrong'}},'REVIEW']]){await ev('claim',{...eb,lease:id(1100+offset)});assert.equal((await ev('finish',{lease:id(1100+offset),evidence})).status,status);checks++;}
await ev('claim',{...eb,lease:id(1110)});
await reject(()=>ev('finish',{lease:id(1110),evidence:{...er,invoices:[{...er.invoices[0],payment:'pay_other'}]}}),'22023');
await reject(()=>ev('finish',{lease:id(1110),evidence:{...er,invoices:[er.invoices[0],er.invoices[0]]}}),'22023');
await reject(()=>ev('finish',{lease:id(1110),evidence:{...er,refunds:[{status:'DONE',valueCents:85001,date:'2030-01-20'}]}}),'22023');
await reject(()=>ev('finish',{lease:id(1110),evidence:{...er,privateContact:'secret'}}),'22023');
await ev('finish',{lease:id(1110),evidence:null});
ed=await ev('read',{kind:'CYCLE',id:cy.id,page:0},finance);assert.equal(ed.total,6);assert.equal(ed.rows[0].status,'REVIEW');checks++;
assert.equal((await ev('read',{kind:'CYCLE',id:cy.id,page:1},finance)).rows.length,0);checks++;
await db.query("insert into platform_sales_evidence_attempts(id,kind,source_id,source,actor_id,actor_name,justification,created_at) select $1,kind,source_id,source,actor_id,actor_name,justification,clock_timestamp()-interval '120 seconds' from platform_sales_evidence_attempts where id=$2",[id(1120),eb.lease]);
await ev('claim',{...eb,lease:id(1121)});await reject(()=>ev('finish',{lease:id(1120),evidence:er}),'P3691');await ev('finish',{lease:id(1121),evidence:er});checks++;
for(const table of ['platform_sales_evidence_attempts','platform_sales_evidence_revisions']){await reject(()=>db.query('delete from '+table),'42501');for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await reject(()=>db.query('select * from '+table),'42501');await db.exec('RESET ROLE');}}
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>ev('read',{kind:'CYCLE',id:cy.id,page:0}),'42501');await db.exec('RESET ROLE');}
assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);checks++;
console.log('4H evidence: snapshots, partial data, immutable identity, isolation, no prior totals changed.');

await db.query("insert into platform_sales_asaas_inbox(id,provider_id,event,payment_id,summary,hash,received_at) values($1,'evt_cycle_late','PAYMENT_UPDATED','pay_cycle',$2,repeat('b',64),clock_timestamp()+interval '1 second')",[id(986),JSON.stringify({id:'pay_cycle',customer:'cus_recurrence',reference:b.id,grossCents:85000,status:'PENDING',netCents:84901})]);cd=await readCycles();assert.equal(cd.rows[0].state,'UNKNOWN');assert.equal(cd.totals.receivedGrossCents,'0');checks++;
await cycle('claim',{...cy,lease:id(987)});await cycle('finish',{lease:id(987),summary:{...verified,subscription:'sub_wrong'}});cd=await readCycles();assert.equal(cd.rows[0].state,'UNKNOWN');checks++;
await cycle('claim',{...cy,lease:id(988)});await cycle('finish',{lease:id(988),summary:null});cd=await readCycles();assert.equal(cd.history[0].status,'REVIEW');checks++;
await cycle('claim',{...cy,sequence:3,id:id(990),lease:id(989)});assert.equal((await cycle('finish',{lease:id(989),summary:{...verified,dueDate:'2030-02-28'}})).status,'REVIEW');assert.equal((await db.query('select count(*)::int n from platform_sales_cycle_bindings')).rows[0].n,1);checks++;
await db.query("insert into platform_sales_asaas_bindings(id,proposal_id,payment_id,customer_id,company,gross_cents,source,actor_id,actor_name,justification) select $1,proposal_id,'pay_cycle',customer_id,company,gross_cents,source,actor_id,actor_name,'Fixture conflicting origin' from platform_sales_asaas_bindings limit 1",[id(991)]);cd=await readCycles();assert.equal(cd.rows[0].reason,'DUPLICATE_ORIGIN');assert.equal(cd.totals.receivedGrossCents,'0');await reject(()=>cycle('claim',{...cy,lease:id(992)}),'P3681');checks++;
await db.exec('ALTER TABLE user_profiles RENAME TO profiles_unavailable');cd=await readCycles();assert.equal(cd.history[0].current_actor_name,null);assert.ok(cd.history[0].actor_name);await db.exec('ALTER TABLE profiles_unavailable RENAME TO user_profiles');checks++;
for(const table of ['platform_sales_cycle_bindings','platform_sales_cycle_attempts','platform_sales_cycle_checks']){await reject(()=>db.query('delete from '+table),'42501');for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await reject(()=>db.query('select * from '+table),'42501');await db.exec('RESET ROLE');}}
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>cycle('read',{page:0,search:'',state:''}),'42501');await db.exec('RESET ROLE');}
assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);checks++;
console.log('4G cycle checks: wrong cycle rollback, concurrency, GET failure, no double count, late events and Finance isolation passed.');

console.log('4F subscription commands: source approval, concurrency, reservation, uncertainty, reconciliation, author and Finance isolation passed.');

console.log('4F recurrence preparation: duplicate cycles, fees, version races, Finance isolation and author history passed.');
}`;
const fixture=fs.readFileSync('test/sales-offer-terms-sql.cjs','utf8').replace('await db.close();console.log(',()=>prior+'\n'+cases+'\nawait db.close();console.log(');
new Function('require',fixture)(require);
