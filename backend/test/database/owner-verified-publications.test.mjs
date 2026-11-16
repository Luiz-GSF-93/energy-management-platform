import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=x=>{assert.ok(x);checks++;},owner='00000000-0000-4000-8000-000000000001';
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE eva_automatic_intakes(id uuid PRIMARY KEY,organization_id text,state text,lease_token uuid,document_type text,document_id text,updated_at timestamptz DEFAULT now());
 CREATE TABLE verified_fixture(id uuid PRIMARY KEY,organization_id text);
 CREATE FUNCTION platform_eva_stability(p_actor uuid,p_search text DEFAULT '',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF p_actor IS DISTINCT FROM '${owner}'::uuid THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;RETURN jsonb_build_object('responsible','OWNER','rows',jsonb_build_array(jsonb_build_object('organizationId','org-a','activeLicenses',1,'closingReceipts',0,'attention',true,'manual',jsonb_build_object('uncertain',0,'failed30d',0,'oldestQueueSeconds',0),'intakes',jsonb_build_object('technical',(SELECT count(*) FROM public.eva_automatic_intakes WHERE organization_id='org-a' AND state='UNKNOWN')))));END$$;
 CREATE FUNCTION eva_intake_published_completions(p_org text,p_ids uuid[]) RETURNS jsonb LANGUAGE sql AS $$SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'publicationId',id)),'[]') FROM public.verified_fixture WHERE organization_id=p_org AND id=ANY(p_ids)$$;
 INSERT INTO eva_automatic_intakes VALUES('${owner}','org-a','UNKNOWN',NULL,'INVOICE_DISTRIBUTOR','source',now()),('00000000-0000-4000-8000-000000000002','foreign','UNKNOWN',NULL,'INVOICE_DISTRIBUTOR','foreign-source',now());
 INSERT INTO verified_fixture VALUES('${owner}','org-a'),('00000000-0000-4000-8000-000000000002','foreign');`);
 const migration=readFileSync('src/database/migrations/20261329_owner_verified_publication_counts.sql','utf8');await db.exec(migration);await db.exec(migration);
 const view=async()=> (await db.query('SELECT platform_eva_stability($1) value',[owner])).rows[0].value;
 let r=await view();ok(r.rows[0].intakes.technical===0);ok(r.rows[0].intakes.publishedHistorical===1);ok(r.rows[0].attention===false);ok((await db.query('SELECT state FROM eva_automatic_intakes WHERE id=$1',[owner])).rows[0].state==='UNKNOWN');
 await assert.rejects(db.query('SELECT platform_eva_stability($1)',['00000000-0000-4000-8000-000000000003']),e=>e.code==='42501');checks++;
 await db.exec('DELETE FROM verified_fixture');r=await view();ok(r.rows[0].intakes.technical===1);ok(r.rows[0].attention===true);ok(r.rows[0].intakes.publishedHistorical===0);
 for(const role of ['anon','authenticated','service_role']){ok((await db.query("SELECT has_function_privilege($1,'platform_eva_stability_before_verified_publications(uuid,text,integer)','EXECUTE') value",[role])).rows[0].value===false);}
 for(const role of ['anon','authenticated'])ok((await db.query("SELECT has_function_privilege($1,'platform_eva_stability(uuid,text,integer)','EXECUTE') value",[role])).rows[0].value===false);
 console.log('Owner verified publications:',checks,'isolated assertions passed, preserving history and Owner authorization.');
}finally{await db.close();}
