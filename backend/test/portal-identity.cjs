// Synthetic PostgreSQL only. No secrets, network APIs or production data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let {PGlite}=require('@electric-sql/pglite');
if(process.env.PORTAL_IDENTITY_TEST_PG_PORT){if(process.env.PORTAL_IDENTITY_TEST_PG_PORT!=='55485')throw Error('Disposable loopback only');const {Pool}=require('pg');PGlite=class{constructor(){this.pool=new Pool({host:'127.0.0.1',port:55485,user:'postgres',database:'postgres',max:4})}exec(s){return this.pool.query(s)}query(s,a){return this.pool.query(s,a)}close(){return this.pool.end()}};}
const owner='00000000-0000-4000-8000-000000000001',admin='00000000-0000-4000-8000-000000000002',client='00000000-0000-4000-8000-000000000003';
(async()=>{const db=new PGlite();let n=0;const ok=(x,m)=>{assert.ok(x,m);n++},deny=async f=>{await assert.rejects(f);n++};try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
 CREATE TABLE organizations(id text PRIMARY KEY,name text,deleted_at timestamptz);INSERT INTO organizations VALUES('org_a','Organization A',null),('org_b','Organization B',null);
 CREATE TABLE roles(id text PRIMARY KEY,organization_id text,scope text,name text);INSERT INTO roles VALUES('admin','org_a','organization','admin_org'),('reader','org_a','organization','consulta'),('foreign','org_b','organization','admin_org');
 CREATE TABLE organization_members(organization_id text,user_id uuid,role_id text,status text,affiliation_type text,exclusive_customer_id text);INSERT INTO organization_members VALUES('org_a','${admin}','admin','active','internal',null),('org_a','${client}','reader','active','external','customer_a');
 CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,revoked_at timestamptz,expires_at timestamptz);INSERT INTO platform_organization_sessions VALUES('org_a','${owner}',null,now()+interval '1 hour');
 CREATE FUNCTION assert_license_platform_actor(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF $1<>'${owner}'::uuid THEN RAISE EXCEPTION 'Denied';END IF;END$$;
 CREATE TABLE fixture_license(enabled boolean);INSERT INTO fixture_license VALUES(true);
 CREATE FUNCTION client_portal_entitlement(text,text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('enabled',enabled,'customerId','customer_a') FROM public.fixture_license$$;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261120_portal_identity.sql'),'utf8'));
 const action=(org,actor,role,platform,kind,revision=null,body={})=>db.query('SELECT organization_branding_action($1,$2,$3,$4,$5,$6,$7) data',[org,actor,role,platform,kind,revision,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const body=(name='one')=>({object_path:'org_a/'+name+'.png',sha256:'a'.repeat(64),mime:'image/png',bytes:100,reason:'Brand reviewed in disposable fixture.'});
 ok((await action('org_a',client,'reader',false,'read')).name==='Organization A');
 await deny(()=>action('org_b',admin,'admin',false,'read'));await deny(()=>action('org_a',client,'reader',false,'access'));await deny(()=>action('org_b',owner,'owner',true,'read'));
 await deny(()=>action('org_a',admin,'admin',false,'save',0,{...body(),object_path:'orgXa/foreign.png'}));
 ok((await action('org_a',admin,'admin',false,'save',0,body())).revision===1);
 const races=await Promise.allSettled(['two','three'].map(name=>action('org_a',admin,'admin',false,'save',1,body(name))));ok(races.filter(x=>x.status==='fulfilled').length===1,'same revision has one winner');
 ok((await action('org_a',owner,'owner',true,'read')).revision===2);
 await db.exec('UPDATE fixture_license SET enabled=false');await deny(()=>action('org_a',client,'reader',false,'read'));await db.exec('UPDATE fixture_license SET enabled=true');
 await db.exec(`UPDATE organization_members SET status='inactive' WHERE user_id='${admin}'`);await deny(()=>action('org_a',admin,'admin',false,'save',2,body('four')));
 await deny(()=>db.exec('UPDATE organization_branding_versions SET revision=99'));await deny(()=>db.exec('DELETE FROM organization_branding_versions'));
 await db.exec('SET ROLE authenticated');await deny(()=>db.exec('SELECT * FROM public.organization_branding_versions'));await deny(()=>action('org_a',client,'reader',false,'read'));await db.exec('RESET ROLE');
 ok((await db.query("SELECT public FROM storage.buckets WHERE id='organization-branding'")).rows[0].public===false);
 // The delegated publication gate is independently covered by eva-approved-publications.cjs.
 await db.exec(`CREATE TABLE eva_assisted_closing_versions(id uuid,organization_id text,customer_id text,month text,payload_hash text,report jsonb);
 CREATE TABLE consumer_units(id text,organization_id text,customer_id text,status text);INSERT INTO consumer_units VALUES('unit','org_a','customer_a','ACTIVE');
 CREATE TABLE monthly_energy_settlements(organization_id text,customer_id text,month date,status text,published_at timestamptz);
 CREATE TABLE fixture_publications(body jsonb);CREATE FUNCTION read_eva_closing_publications(text,text,text,boolean,boolean,text,text,text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF $1<>'org_a' OR $2<>'${client}' OR $8<>'customer_a' THEN RAISE EXCEPTION 'Denied';END IF;RETURN coalesce((SELECT jsonb_agg(body) FROM public.fixture_publications),'[]');END$$;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261121_portal_published_components.sql'),'utf8'));
 const pub={id:'00000000-0000-4000-8000-000000000010',closingId:'00000000-0000-4000-8000-000000000011',sourceHash:'b'.repeat(64),publishedAt:'2026-10-19T10:00:00Z',state:'PUBLISHED',projection:{customerId:'customer_a',month:'2026-09'}};
 await db.query('INSERT INTO fixture_publications VALUES($1)',[JSON.stringify(pub)]);
 await db.query('INSERT INTO eva_assisted_closing_versions VALUES($1,$2,$3,$4,$5,$6)',[pub.closingId,'org_a','customer_a','2026-09',pub.sourceHash,JSON.stringify({private:'PRIVATE',units:[{id:'unit',name:'Unit',notes:'PRIVATE',prepared:{invoice:{amount:'100.00'},supplier:{amount:'40.00'}},methodology:{lines:[],retained:[]},fields:[{key:'address',value:'PRIVATE',state:'FILLED'},{key:'consumptionTotal',value:'1000',state:'FILLED',source:'PRIVATE'}],acr:'200.00',aclBeforeFees:'140.00',aclAfterFees:'150.00',totalFees:'10.00'}]})]);
 const read=()=>db.query('SELECT read_eva_published_components($1,$2,$3,false,true,$4,$5,$6) data',['org_a',client,'reader','2026-09','2026-09','customer_a']).then(r=>r.rows[0].data);
 const rows=await read();ok(rows.length===1);ok(!JSON.stringify(rows).includes('PRIVATE'));ok(rows[0].fields.length===1);
 await db.query('UPDATE fixture_publications SET body=$1',[JSON.stringify({...pub,state:'WITHDRAWN'})]);ok((await read()).length===0,'withdrawal removes detail');
 await db.query('UPDATE fixture_publications SET body=$1',[JSON.stringify(pub)]);await db.exec("UPDATE eva_assisted_closing_versions SET payload_hash=repeat('c',64)");ok((await read()).length===0,'source mismatch removes detail');
 console.log(n+' private portal identity/component SQL checks passed');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
