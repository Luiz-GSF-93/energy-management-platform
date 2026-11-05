const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();try{
 const original=fs.readFileSync(path.join(__dirname,'audit-workspaces.cjs'),'utf8');
 const fixture=original.match(/await db\.exec\(`(CREATE ROLE anon;[\s\S]+?)`\);/)[1];await db.exec(fixture);
 for(const f of ['20261218_audit_workspaces.sql','20261219_audit_historical_dates.sql','20261220_audit_actor_names.sql','20261255_audit_session_author_names.sql','20261271_audit_alert_evidence.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations',f),'utf8'));
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',g='33333333-3333-4333-8333-333333333333';
 for(const [id,org] of [[a,'A'],[b,'B'],[g,null]]){
 await db.query('INSERT INTO auth.users(id)VALUES($1)',[id]);await db.query('INSERT INTO roles VALUES($1,$2,$3,$4,$5)',[id,org,org?'admin_org':'admin_platform',org?'organization':'global',JSON.stringify(org?['dbb580ca-d940-4e80-97fb-e9f9619a0001']:['dbb580ca-d940-4e80-97fb-e9f9619a0004'])]);
 if(org){await db.query('INSERT INTO organizations VALUES($1,NULL)',[org]);await db.query("INSERT INTO organization_members VALUES($1,$2,$2,'active','internal',NULL)",[org,id]);await db.query("INSERT INTO licenses(id,organization_id,active,status,start_date,organization_audit)VALUES($1,$2,true,'ACTIVE',current_date-1,true)",[org,org]);}else{await db.query('INSERT INTO user_roles VALUES($1,$1)',[id]);await db.query("INSERT INTO platform_team_members VALUES($1,true,'OWNER')",[id]);}}
 await db.query("INSERT INTO user_profiles(user_id,name) VALUES($1,'Ana Interna')",[a]);
 const alert='44444444-4444-4444-8444-444444444444';await db.query("INSERT INTO energy_audit_alerts(id,organization_id,kind,subject,evidence_count,first_at,last_at) VALUES($1,'A','DENIED',$2,30,now()-interval '1 minute',now())",[alert,a]);
 for(let i=0;i<30;i++)await db.query("INSERT INTO energy_audit_events(id,organization_id,actor_id,module,action,result,ip,ip_basis,created_at) VALUES(gen_random_uuid(),'A',$1,'documents','READ','DENIED','private-ip','CONNECTION_ONLY',now()-interval '30 seconds')",[a]);
 await db.query("INSERT INTO energy_audit_events(id,organization_id,actor_id,module,action,result,created_at) VALUES(gen_random_uuid(),'B',$1,'secret-B','READ','DENIED',now()-interval '30 seconds')",[a]);
 const read=async(org,actor,global=false,page=0)=>(await db.query('SELECT energy_audit_alert_evidence($1,$2,$3,$4,$5) d',[org,actor,global,alert,page])).rows[0].d;
 let d=await read('A',a);assert.equal(d.total,30);assert.equal(d.rows.length,25);assert.equal(d.rows[0].actorName,'Ana Interna');assert.ok(!('ip' in d.rows[0]));assert.ok(!JSON.stringify(d).includes('private-ip'));assert.equal((await read('A',a,false,1)).rows.length,5);
 await assert.rejects(read('B',b));await assert.rejects(read('A',b));await assert.rejects(read(null,a,true));await assert.rejects(read('A',a,false,-1));assert.equal((await read(null,g,true)).total,30);
 await db.query("UPDATE roles SET permissions=permissions||'[\"dbb580ca-d940-4e80-97fb-e9f9619a0002\"]'::jsonb WHERE id=$1",[a]);d=await read('A',a);assert.equal(d.rows[0].ip,'private-ip');
 await db.query("UPDATE organization_members SET permission_limit='[]' WHERE user_id=$1",[a]);await assert.rejects(read('A',a));
 console.log('Audit alert evidence: migration, tenant/global isolation, restricted IP, membership ceiling, author names and stable pagination passed.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
