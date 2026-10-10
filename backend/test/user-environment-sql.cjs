
const assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
let checks=0;const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
(async()=>{const db=new PGlite();await db.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;INSERT INTO auth.users VALUES('${user}'),('${other}');`);
await db.exec(fs.readFileSync('src/database/migrations/20261010_user_environment_preferences.sql','utf8'));
const prefs={revision:0,theme:'blue',avatar_kind:'initials',emoji:'🙂',photo:'',cep:'',personal_phone:''};
const save=(id,rev,p)=>db.query('SELECT save_user_environment_preferences($1,$2,$3) value',[id,rev,JSON.stringify(p)]);
assert.equal((await save(user,0,prefs)).rows[0].value.revision,1);checks++;
await assert.rejects(()=>save(user,0,prefs),e=>e.code==='40001');checks++;
await save(other,0,{...prefs,theme:'light'});await save(user,1,{...prefs,theme:'graphite'});
const rows=(await db.query('SELECT user_id,revision,theme FROM user_environment_preferences ORDER BY user_id')).rows;assert.equal(rows[0].theme,'graphite');assert.equal(rows[1].theme,'light');checks+=2;
const events=(await db.query('SELECT * FROM user_environment_events ORDER BY user_id,revision')).rows;assert.equal(events.length,3);checks++;
assert.deepEqual(events[1].changed_fields,['theme']);assert.ok(!JSON.stringify(events).includes('personal@example'));checks+=2;
await assert.rejects(()=>save(user,2,{...prefs,name:'Illegal'}),e=>e.code==='22023');checks++;
await assert.rejects(()=>save(user,2,{...prefs,theme:'invalid'}),e=>e.code==='23514');checks++;
assert.equal((await db.query('SELECT revision FROM user_environment_preferences WHERE user_id=$1',[user])).rows[0].revision,2);checks++;
await db.exec('SET ROLE authenticated');
for(const q of ['SELECT * FROM user_environment_preferences','SELECT * FROM user_environment_events',`SELECT save_user_environment_preferences('${user}',2,'{}')`]){await assert.rejects(()=>db.exec(q),e=>e.code==='42501');checks++;}
await db.exec('RESET ROLE');await db.exec('SET ROLE anon');await assert.rejects(()=>db.exec('SELECT * FROM user_environment_preferences'),e=>e.code==='42501');checks++;await db.exec('RESET ROLE');
console.log('Private persistence / conflict / RLS:',checks,'checks passed');await db.close();})().catch(e=>{console.error(e);process.exit(1)});
