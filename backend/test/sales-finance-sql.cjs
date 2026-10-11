// Reuse audited commercial + 4A fixtures, in a disposable database only.
const fs=require('fs');
const old=fs.readFileSync('test/sales-asaas-sql.cjs','utf8').match(/const cases=String.raw`([\s\S]*?)`;/)[1];
const cases=String.raw`{
await db.exec('CREATE TABLE permissions(id uuid PRIMARY KEY,code text,name text,module text,resource text,action text)');
const migration=fs.readFileSync('src/database/migrations/20261010_platform_sales_finance_read.sql','utf8');await db.exec(migration);await db.exec(migration);
const permission='c767190a-5ec0-4d89-8675-688415e967b1';
assert.equal((await db.query('select count(*)::int n from roles where permissions ? $1',[permission])).rows[0].n,0);checks++;
const read=(a=owner,filter={},detail=null)=>db.query('select read_platform_sales_finance($1,$2,$3,$4,$5,$6,$7) result',[a,filter.page??0,filter.search??'',filter.status??'',filter.from??null,filter.to??null,detail]).then(x=>x.rows[0].result);
await reject(()=>read(null),'42501');await reject(()=>read(other),'42501');
await db.query("insert into roles values('f','global','platform_finance','platform','[]')");await db.query('insert into user_roles values($1,$2)',[other,'f']);await db.query("update platform_team_members set profile='FINANCE' where user_id=$1",[other]);
await reject(()=>read(other),'42501');await db.query('update roles set permissions=$1 where id=$2',[JSON.stringify([permission]),'f']);await read(other);checks++;
for(const profile of ['ADMINISTRATOR','SUPPORT','OPERATOR']){await db.query('update platform_team_members set profile=$1 where user_id=$2',[profile,other]);await reject(()=>read(other),'42501');}
await db.query("update platform_team_members set profile='FINANCE',active=false where user_id=$1",[other]);await reject(()=>read(other),'42501');await db.query('update platform_team_members set active=true where user_id=$1',[other]);
await db.query("update roles set scope='organization' where id='f'");await reject(()=>read(other),'42501');await db.query("update roles set scope='global' where id='f'");
await db.exec('ALTER TABLE user_profiles ADD COLUMN name text');await db.query('update user_profiles set name=$1 where user_id=$2',['Real Fixture Name',owner]);
const binding2={id:id(600),proposalId:id(2),paymentId:'pay_4b',customerId:'cus_4b',justification:'Sandbox fixture only.'};
const run=(action,body,a=owner)=>db.query('select platform_sales_asaas_action($1,$2,$3) result',[a,action,JSON.stringify(body)]).then(x=>x.rows[0].result);
const saved=await run('bind',binding2);assert.equal(saved.actor_name,'Real Fixture Name');checks++;
const summary2={id:'pay_4b',customer:'cus_4b',reference:binding2.id,grossCents:85000,netCents:null,status:'PENDING'};
const inbox=async(n,summary,event='PAYMENT_UPDATED')=>run('inbox',{event:{id:'evt_4b_'+n,event,payment:summary},hash:String(n).padStart(64,'0')},null);
const first=await inbox(1,summary2);await run('claim',{id:first.id,lease:id(601)});await run('finish',{id:first.id,lease:id(601),summary:summary2});
let list=await read(other,{search:'pay_4b'});assert.equal(list.total,1);assert.equal(list.rows[0].status,'PENDING');assert.equal(list.rows[0].netCents,null);checks++;
await inbox(2,{...summary2,status:'RECEIVED'},'PAYMENT_RECEIVED');list=await read(other,{search:'pay_4b'});assert.equal(list.total,1);assert.equal(list.rows[0].status,'PENDING');assert.equal(list.rows[0].pendingEvent,true);checks++;
const third=await inbox(3,{...summary2,status:'RECEIVED'},'PAYMENT_RECEIVED');await run('claim',{id:third.id,lease:id(603)});await run('finish',{id:third.id,lease:id(603),summary:{...summary2,status:'RECEIVED'}});list=await read(other,{search:'pay_4b'});assert.equal(list.rows[0].status,'RECEIVED');checks++;
const oldEvent=await inbox(4,summary2);await run('claim',{id:oldEvent.id,lease:id(604)});await run('finish',{id:oldEvent.id,lease:id(604),summary:{...summary2,status:'RECEIVED'}});list=await read(other,{search:'pay_4b'});assert.equal(list.rows[0].status,'RECEIVED');assert.equal(list.rows[0].requiresReview,true);checks++;
const unavailable=await inbox(5,summary2);await run('claim',{id:unavailable.id,lease:id(605)});await run('finish',{id:unavailable.id,lease:id(605),summary:null});assert.equal((await read(other,{search:'pay_4b'})).rows[0].status,'RECEIVED');checks++;
const wrong=await inbox(6,summary2);await run('claim',{id:wrong.id,lease:id(606)});await run('finish',{id:wrong.id,lease:id(606),summary:{...summary2,reference:id(999),status:'REFUNDED'}});assert.equal((await read(other,{search:'pay_4b'})).rows[0].status,'RECEIVED');checks++;
await db.query('update user_profiles set name=$1 where user_id=$2',['Renamed Fixture',owner]);let detail=await read(other,{},binding2.id);assert.equal(detail.binding.recordedName,'Real Fixture Name');assert.equal(detail.binding.currentName,'Renamed Fixture');assert(detail.events[0].checks.every(c=>c.currentName==='Renamed Fixture'));checks++;
assert(!JSON.stringify(detail).includes('fixture@example.com'));assert(!('source' in detail.binding));assert(!('customer_id' in detail.binding));checks++;
await db.exec('ALTER TABLE user_profiles RENAME TO unavailable_profiles');detail=await read(other,{},binding2.id);assert.equal(detail.binding.currentName,null);assert.equal(detail.binding.recordedName,'Real Fixture Name');assert.equal(detail.binding.actorId,owner);checks++;await db.exec('ALTER TABLE unavailable_profiles RENAME TO user_profiles');
await db.query('update user_profiles set name=NULL,full_name=NULL where user_id=$1',[owner]);assert.equal((await read(other,{},binding2.id)).binding.currentName,null);checks++;
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>read(),'42501');await reject(()=>db.query('select * from platform_sales_asaas_checks'),'42501');await db.exec('RESET ROLE');}
await db.exec('SET ROLE service_role');await read(other);await reject(()=>db.query('select * from platform_sales_asaas_checks'),'42501');await db.exec('RESET ROLE');
await reject(()=>run('bind',{...binding2,id:id(610),paymentId:'pay_unauthorized'},other),'42501');await reject(()=>run('claim',{id:first.id,lease:id(611)},other),'42501');
await db.query('update roles set permissions=$1 where id=$2',['[]','f']);await reject(()=>read(other),'42501');
await reject(()=>read(owner,{page:1001}),'22023');await reject(()=>read(owner,{status:'PAID'}),'22023');await reject(()=>read(owner,{from:'2026-10-10',to:'2026-10-09'}),'22023');await reject(()=>read(owner,{},id(999)),'P3610');
assert.equal((await read(owner,{search:'absent'})).total,0);assert.equal((await read(owner,{page:1})).rows.length,0);assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);checks++;
console.log('4B finance read, role isolation, no auto-grant, current vs recorded names and one row per payment passed.');
}`;
const fixture=fs.readFileSync('test/sales-offer-terms-sql.cjs','utf8').replace('await db.close();console.log(',old+'\n'+cases+'\nawait db.close();console.log(');
new Function('require',fixture)(require);
