import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};const deny=async p=>{await assert.rejects(p);checks++;};
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE actors(org text,id text);INSERT INTO actors VALUES('org','actor');
 CREATE FUNCTION assert_ccee_data_actor(o text,a text,action text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT 1 FROM public.actors WHERE org=o AND id=a) THEN RAISE EXCEPTION 'denied';END IF;END$$;
 CREATE TABLE ccee_price_observations(id uuid DEFAULT gen_random_uuid(),organization_id text,period_start timestamptz,submarket text,value_brl_mwh numeric,source_hash text,retrieved_at timestamptz DEFAULT now());
 CREATE TABLE energy_price_pld_monthly(organization_id text,month date,submarket text,mean_brl_mwh numeric,hours integer,source text,source_hash text);
 CREATE TABLE docs(release uuid,revision uuid,org text,active boolean);
 CREATE TABLE eva_search_chunks(release_id uuid,id text,content text,content_hash text);
 CREATE TABLE eva_composite_release_batches(release_id uuid,state text,chunks jsonb);
 CREATE FUNCTION eva_corpus_rag(a uuid,o text,r text,operation boolean,action text,body jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF o<>'org' OR r<>'allowed' THEN RAISE EXCEPTION 'denied';END IF;RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('releaseId',release,'revisionId',revision)) FROM public.docs WHERE org=o AND active),'[]'::jsonb);END$$;
 CREATE FUNCTION eva_composite_rag(a uuid,o text,r text,operation boolean,action text,body jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT public.eva_corpus_rag(a,o,r,operation,action,body)$$;`);
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261228_ccee_market_assessment.sql',import.meta.url),'utf8'));
 const hist=async(org='org',actor='actor')=>(await db.query("SELECT ccee_market_monthly_history($1,$2,'2025-02-28') result",[org,actor])).rows[0].result;
 await db.exec(`INSERT INTO energy_price_pld_monthly VALUES ('org','2025-01-01','SE_CO',100,744,'https://www.ccee.org.br',repeat('a',64)),('org','2025-02-01','SE_CO',200,672,'https://www.ccee.org.br',repeat('b',64)),('org','2025-03-01','SE_CO',300,744,'https://www.ccee.org.br',repeat('c',64)),('foreign','2025-01-01','SE_CO',999,744,'https://www.ccee.org.br',repeat('d',64)),('org','2025-01-01','S',500,1,'https://www.ccee.org.br',repeat('e',64));`);
 const h=await hist();ok(h.organizationId==='org'&&h.rows.length===2,'only complete months in scope and cutoff');ok(h.rows.every(r=>r.hours===r.expectedHours),'partial monthly source not promoted');ok(h.rows[1].value==='200.000000','month-end cutoff includes complete February');await deny(hist('foreign','actor'));await deny(hist('org','foreign'));
 await db.exec(`INSERT INTO ccee_price_observations(organization_id,period_start,submarket,value_brl_mwh,source_hash) SELECT 'org',v,'NE',150,repeat('f',64) FROM generate_series('2025-01-01T03:00:00Z'::timestamptz,'2025-02-01T02:00:00Z'::timestamptz,'1 hour')v;`);
 ok((await hist()).rows.some(r=>r.submarket==='NE'&&r.hours===744&&r.origin==='SOAP'),'complete hourly history is an eligible monthly reference');
 const actor='10000000-0000-4000-8000-000000000001',release='20000000-0000-4000-8000-000000000001',foreign='20000000-0000-4000-8000-000000000002',rev='30000000-0000-4000-8000-000000000001';
 await db.query('INSERT INTO docs VALUES($1,$2,$3,true),($4,$2,$5,true)',[release,rev,'org',foreign,'foreign']);await db.query('INSERT INTO eva_search_chunks VALUES($1,$2,$3,$4),($5,$6,$7,$4)',[release,'chunk-a','PLD e preço por submercado','a'.repeat(64),foreign,'foreign-chunk','PLD preço contratação informação privada']);
 const lookup=async(org='org',role='allowed')=>(await db.query("SELECT eva_market_local_hits($1,$2,$3,false,'2025-02-28',false) result",[actor,org,role])).rows[0].result;
 const result=await lookup();ok(result.hits.length===1&&result.hits[0].chunkId==='chunk-a','text search only touches eligible source releases');await deny(lookup('foreign'));await deny(lookup('org','denied'));
 await db.query('UPDATE docs SET active=false WHERE release=$1',[release]);ok((await lookup()).hits.length===0,'revocation removes local candidates');
 for(const signature of ['ccee_market_monthly_history(text,text,date)','eva_market_local_hits(uuid,text,text,boolean,date,boolean)'])ok(!(await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,'browser roles cannot call private RPC');
 console.log(checks+' monthly history and local documentary RPC checks passed');
}catch(e){console.error(e.message,e.where??'',e.stack);process.exitCode=1;}finally{await db.close();}
