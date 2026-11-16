import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite(),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE trading_records(id uuid PRIMARY KEY,organization_id text,kind text,data jsonb);
 CREATE TABLE trading_invitations(id uuid PRIMARY KEY,organization_id text,opportunity_id uuid,supplier_id uuid,kind text,state text,email text,expires_at timestamptz,created_at timestamptz DEFAULT now());
 CREATE TABLE trading_quote_threads(organization_id text,invitation_id uuid,status text,urgency int);
 CREATE TABLE trading_quote_messages(id uuid PRIMARY KEY,organization_id text,invitation_id uuid,author_type text,body text,urgency int,created_at timestamptz,status text);
 CREATE TABLE trading_quote_mail_outbox(organization_id text,invitation_id uuid,state text,kind text,created_at timestamptz,diagnostic text);
 CREATE FUNCTION assert_trading_actor(o text,a text,w boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF o<>'org' OR a<>'operator' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;END$$;
 CREATE FUNCTION trading_quote_is_live(o text,i uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.trading_records WHERE organization_id=o AND id=i AND (data->>'expiresAt')::timestamptz>now())$$;
 INSERT INTO trading_records VALUES('${id(1)}','org','supplier','{"tradeName":"Company A"}'),('${id(2)}','org','opportunity',jsonb_build_object('title','Current round','expiresAt',now()+interval '1 day')),('${id(3)}','org','opportunity',jsonb_build_object('title','Old round','expiresAt',now()-interval '1 day')),('${id(9)}','foreign','supplier','{"tradeName":"Foreign"}');
 INSERT INTO trading_invitations VALUES('${id(4)}','org','${id(2)}','${id(1)}','SUPPLIER','PENDING','synthetic@example.test',now()+interval '1 day',now()),('${id(5)}','org','${id(3)}','${id(1)}','SUPPLIER','PENDING','synthetic@example.test',now()-interval '1 day',now()-interval '1 month');
 INSERT INTO trading_quote_threads VALUES('org','${id(4)}','WAITING_BACKOFFICE',3),('org','${id(5)}','WAITING_BACKOFFICE',3);
 INSERT INTO trading_quote_messages SELECT gen_random_uuid(),'org','${id(5)}','SUPPLIER','Original message '||s,1,now()-s*interval '1 minute','WAITING_BACKOFFICE' FROM generate_series(1,55)s;
 `);
 await db.exec(readFileSync('src/database/migrations/20261330_trading_company_conversations.sql','utf8'));
 const call=async(supplier=null,page=0,thread=null,messagePage=0,org='org',actor='operator')=>(await db.query('SELECT trading_quote_company_conversations($1,$2,$3,$4,$5,$6) value',[org,actor,supplier,page,thread,messagePage])).rows[0].value;
 let r=await call();assert.equal(r.total,1);assert.equal(r.rows.length,1);assert.equal(r.rows[0].rounds,2);assert.equal(r.rows[0].active,1);assert.equal(r.rows[0].pending,1);assert(!JSON.stringify(r).includes('Original message'));
 r=await call(id(1));assert.equal(r.rows.length,2);assert.equal(r.rows.find(t=>t.id===id(5)).status,'EXPIRED');assert.equal(r.rows.find(t=>t.id===id(4)).status,'WAITING_BACKOFFICE');
 r=await call(id(1),0,id(5));assert.equal(r.rows[0].messages.length,50);assert.equal(r.rows[0].messageTotal,55);const first=r.rows[0].messages.map(m=>m.id);
 r=await call(id(1),0,id(5),1);assert.equal(r.rows[0].messages.length,5);assert(r.rows[0].messages.every(m=>!first.includes(m.id)));assert.equal((await call(null,1)).rows.length,0);
 for(const args of [[id(9)],[id(1),0,id(9)],[id(1),-1],[id(1),0,null,-1],[null,0,null,0,'foreign'],[null,0,null,0,'org','external']])await assert.rejects(call(...args));
 for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'trading_quote_company_conversations(text,text,uuid,integer,uuid,integer)','EXECUTE') value",[role])).rows[0].value,false);
 assert.equal((await db.query('SELECT count(*)::int n FROM trading_quote_messages')).rows[0].n,55);
 console.log('PASS company inbox: grouped list, live/expired rounds, complete paginated history, tenant isolation and private grants; no message writes.');
}finally{await db.close();}
