// Disposable database, synthetic invitations only. No e-mail, external API or production writes.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=v=>{assert.ok(v);checks++;};
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE trading_records(id uuid PRIMARY KEY,organization_id text,live boolean);
 CREATE TABLE trading_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text,opportunity_id uuid,kind text,state text,email text,token_hash text,expires_at timestamptz,session_hash text,session_expires_at timestamptz,otp_day date,otp_day_count integer DEFAULT 0,otp_hash text,otp_expires_at timestamptz,otp_sent_at timestamptz,otp_attempts integer DEFAULT 0);
 CREATE TABLE trading_portal_audit(organization_id text,invitation_id uuid,action text,identity text,details jsonb);
 CREATE FUNCTION assert_trading_actor(o text,a text,w boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF o<>'licensed' OR a<>'operator' OR NOT w THEN RAISE EXCEPTION 'Denied';END IF;END$$;
 CREATE FUNCTION trading_license_active(o text) RETURNS boolean LANGUAGE sql AS $$SELECT o='licensed'$$;
 CREATE FUNCTION trading_quote_is_live(o text,i uuid) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce((SELECT live FROM public.trading_records WHERE organization_id=o AND id=i),false)$$;
 INSERT INTO trading_records VALUES('00000000-0000-4000-8000-000000000001','licensed',true);
 INSERT INTO trading_invitations(organization_id,opportunity_id,kind,state,email,token_hash,expires_at) VALUES('licensed','00000000-0000-4000-8000-000000000001','SUPPLIER','PENDING','synthetic@example.test','token-hash',now()+interval '2 days');`);
 await db.exec(readFileSync('src/database/migrations/20261338_trading_supplier_reentry.sql','utf8'));
 const challenge=()=>db.query("SELECT trading_otp_challenge('token-hash','otp-hash') a").then(r=>r.rows[0].a);
 const verify=(otp='otp-hash',session='session-one')=>db.query('SELECT trading_otp_verify($1,$2,$3) a',['token-hash',otp,session]).then(r=>r.rows[0].a);
 const reset=async(state='PENDING',kind='SUPPLIER')=>db.query("UPDATE trading_invitations SET state=$1,kind=$2,organization_id='licensed',expires_at=now()+interval '2 days',otp_sent_at=NULL,otp_day_count=0,otp_attempts=0,otp_hash=NULL,session_hash=NULL",[state,kind]);
 ok(await challenge());ok(!await challenge());ok(await verify());ok(!await verify());
 await db.exec("UPDATE trading_invitations SET otp_sent_at=now()-interval '61 seconds',session_expires_at=now()-interval '1 second'");
 ok(await challenge());ok(await verify('otp-hash','session-two'));
 const reopened=(await db.query('SELECT token_hash,session_hash,state,session_expires_at<=now()+interval \'1 hour\' bounded FROM trading_invitations')).rows[0];
 ok(reopened.token_hash==='token-hash'&&reopened.session_hash==='session-two'&&reopened.state==='PENDING'&&reopened.bounded);
 for(const state of ['RESPONDED','DECLINED']){await reset(state);ok(await challenge());ok(await verify());ok((await db.query('SELECT state FROM trading_invitations')).rows[0].state===state);}
 for(const [state,kind]of [['REVOKED','SUPPLIER'],['APPROVED','CLIENT'],['RESPONDED','CLIENT'],['DECLINED','CLIENT']]){await reset(state,kind);ok(!await challenge());ok(!await verify());}
 await reset('RESPONDED');const invitationId=(await db.query('SELECT id FROM trading_invitations')).rows[0].id;
 await assert.rejects(db.query('SELECT revoke_trading_invitation($1,$2,$3)',['foreign','operator',invitationId]));checks++;
 ok((await db.query('SELECT revoke_trading_invitation($1,$2,$3) a',['licensed','operator',invitationId])).rows[0].a);ok(!await challenge());ok(!await verify());ok((await db.query("SELECT count(*)::int n FROM trading_portal_audit WHERE action='REVOKED'")).rows[0].n===1);
 await reset('PENDING','CLIENT');ok(await challenge());ok(await verify());
 await reset();ok(await challenge());for(let n=0;n<5;n++)ok(!await verify('wrong'));ok(!await verify());
 await reset();await db.exec("UPDATE trading_invitations SET otp_day=CURRENT_DATE,otp_day_count=10");ok(!await challenge());
 await reset();await db.exec("UPDATE trading_invitations SET expires_at=now()-interval '1 second'");ok(!await challenge());ok(!await verify());
 await reset();await db.exec("UPDATE trading_records SET live=false");ok(!await challenge());ok(!await verify());
 await db.exec("UPDATE trading_records SET live=true");await reset();await db.exec("UPDATE trading_invitations SET organization_id='unlicensed'");ok(!await challenge());ok(!await verify());
 ok(!(await db.query("SELECT trading_otp_challenge('unknown','otp') a")).rows[0].a);
 for(const role of ['anon','authenticated'])for(const fn of ['trading_otp_challenge(text,text)','trading_otp_verify(text,text,text)'])ok(!(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') a',[role,fn])).rows[0].a);
 console.log('Trading reentry:',checks,'checks passed');
}finally{await db.close();}
