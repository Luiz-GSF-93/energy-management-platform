import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite();let checks=0;
const permissions=['b142bd7b-05a3-45ee-befd-e593066c2775','cbb2e904-0718-4eec-9396-dba899118cdd','0f2e539d-03f9-4168-bc8c-55ac3a371628'];
const check=v=>{assert.ok(v);checks++;};
const deny=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamp);INSERT INTO organizations VALUES('o1',NULL),('o2',NULL);
 CREATE TABLE customers(id text PRIMARY KEY,organization_id text,company_name text,trade_name text,economic_group text,deleted_at timestamp);
 INSERT INTO customers VALUES('c1','o1','Cliente Um',NULL,'Grupo Um',NULL),('c2','o2','Cliente Dois',NULL,NULL,NULL);
 CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,name text,consumer_unit_number text,address text,city text,state text,distributor text,status text,free_market boolean);
 INSERT INTO consumer_units VALUES('u1','o1','c1','Unidade Um','123','Rua um','Ribeirão Preto','SP','CPFL','ACTIVE',true),('u2','o2','c2','Unidade Dois','456','Rua dois','Rio','RJ','Light','ACTIVE',false);
 CREATE TABLE licenses(organization_id text,active boolean,status text,start_date date,end_date date);
 INSERT INTO licenses VALUES('o1',true,'ACTIVE','2026-01-01',NULL),('o2',true,'ACTIVE','2026-01-01',NULL);
 CREATE TABLE roles(id text PRIMARY KEY,organization_id text,name text,scope text,permissions jsonb);
 CREATE TABLE organization_members(organization_id text,user_id text,role_id text,status text);
 CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
 CREATE FUNCTION assert_license_platform_actor(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Not platform' USING ERRCODE='42501';END $$;`);
 await db.query("INSERT INTO roles VALUES('r1','o1','gestor','organization',$1),('r2','o2','gestor','organization',$1),('rc','o1','consulta','organization',$1)",[JSON.stringify(permissions)]);
 await db.exec("INSERT INTO organization_members VALUES('o1','a1','r1','active'),('o2','a2','r2','active'),('o1','client','rc','active');");
 await db.exec(readFileSync(new URL('../../src/database/migrations/20260927_f1_84_registration_edits.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261005_f9_energy_map.sql',import.meta.url),'utf8'));
 const read=async(org='o1',actor='a1',query={})=>(await db.query('SELECT read_energy_map_units($1,$2,$3) AS v',[org,actor,JSON.stringify(query)])).rows[0].v;
 const save=async(body,org='o1',actor='a1',unit='u1')=>(await db.query('SELECT save_energy_map_location($1,$2,$3,$4) AS v',[org,actor,unit,JSON.stringify(body)])).rows[0].v;

 await db.exec("ALTER TABLE organizations ADD COLUMN name text;UPDATE organizations SET name=id;CREATE TABLE user_roles(user_id text,role_id text);INSERT INTO roles VALUES('rp',NULL,'admin_platform','global','[\"9a679254-bb1a-4353-9d17-cc2bd9eb5abd\"]');INSERT INTO user_roles VALUES('00000000-0000-4000-8000-000000000001','rp');");
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261005_f10_energy_map_platform.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261005_f12_energy_map_gd.sql',import.meta.url),'utf8'));
 const globalRead=async(q={})=>(await db.query('SELECT read_platform_energy_map($1,$2) v',['00000000-0000-4000-8000-000000000001',JSON.stringify(q)])).rows[0].v;
 const edit=async(changes,version,request=randomUUID(),unit='u1')=>(await db.query('SELECT edit_registration($1,$2,$3,$4,$5,$6,$7,$8) v',['o1','consumer_units',unit,'a1','Conferido no contrato da unidade',version,request,JSON.stringify(changes)])).rows[0].v;

 await db.exec(readFileSync(new URL('../../src/database/migrations/20261005_f15_energy_map_radius.sql',import.meta.url),'utf8'));
 let r=await read();check(r.territory.coverage==='FULL_FILTER'&&r.territory.states[0].units===1&&r.territory.distributors[0].label==='CPFL'&&r.radius===null);
 let g=await globalRead();check(g.territory.states.reduce((n,v)=>n+v.units,0)===2&&g.territory.states.length===2);
 const radius={radiusLatitude:-21,radiusLongitude:-47,radiusKm:50};
 check((await read('o1','a1',radius)).total===0);
 await db.exec("INSERT INTO consumer_unit_locations VALUES('o1','u1','c1',-21,-47,'ADDRESS',(SELECT energy_map_address_hash(u) FROM consumer_units u WHERE id='u1'),1,'a1',now());");
 r=await read('o1','a1',radius);check(r.total===1&&r.confirmed===1&&r.rows[0].distanceKm===0&&r.radius.method==='HAVERSINE_6371_V1');check(r.territory.states[0].confirmed===1);
 await db.exec("INSERT INTO consumer_unit_locations VALUES('o2','u2','c2',-21.1,-47,'CITY',(SELECT energy_map_address_hash(u) FROM consumer_units u WHERE id='u2'),1,'a2',now());INSERT INTO customers VALUES('empty','o2','Sem unidade',NULL,NULL,NULL);");
 g=await globalRead(radius);check(g.units===2&&g.withoutUnits===0&&g.rows.find(v=>v.id==='u2').distanceKm>11&&g.rows.find(v=>v.id==='u2').distanceKm<12);
 check((await globalRead({...radius,radiusKm:5})).units===1);check((await globalRead({...radius,organizationId:'o1'})).units===1);
 await deny(()=>read('o1','a2',radius),'42501');await deny(()=>read('o1','client',radius),'42501');
 await db.exec("UPDATE consumer_units SET address='Changed' WHERE id='u1'");check((await read('o1','a1',radius)).total===0);check((await read()).stale===1);
 for(const q of [{radiusKm:50},{...radius,radiusLatitude:91},{...radius,radiusLongitude:-181},{...radius,radiusKm:0},{...radius,radiusKm:501},{...radius,radiusLatitude:'NaN'},{...radius,radiusKm:'50;SELECT 1'},{...radius,radiusLatitude:true}])await deny(()=>read('o1','a1',q),'22023');
 await db.exec("UPDATE consumer_units SET address='Rua um' WHERE id='u1';INSERT INTO consumer_units SELECT 'bulk'||i,'o1','c1','UC'||i,i::text,'Rua','Cidade','SP','CPFL','ACTIVE',true FROM generate_series(1,1000) i;");
 r=await read('o1','a1',{limit:1,offset:0});check(r.total===1001&&r.rows.length===1&&r.territory.states[0].units===1001&&r.territory.profiles[0].units===1001);
 const second=await read('o1','a1',{limit:1,offset:1000});check(JSON.stringify(r.territory)===JSON.stringify(second.territory));
 check((await read('o1','a1',{market:'ACR'})).territory.states.length===0);
 g=await globalRead({limit:1});check(g.total===1003&&g.units===1002&&g.withoutUnits===1&&g.territory.states.reduce((n,v)=>n+v.units,0)===1002);
 await db.exec("UPDATE consumer_units SET has_gd=true,has_bess=true WHERE id='u1'");r=await read('o1','a1',{gd:'YES',bess:'YES'});check(r.territory.profiles.length===1&&r.territory.profiles[0].label==='ACL · GD sim · BESS sim'&&r.total===1);
 await db.exec("ALTER TABLE consumer_units ADD COLUMN deleted_at timestamptz;UPDATE consumer_units SET deleted_at=now() WHERE id='bulk1'");check((await read()).total===1000);check((await globalRead()).units===1001);
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await deny(()=>read(),'42501');await deny(()=>globalRead(),'42501');await deny(()=>db.exec('SELECT energy_map_distance_km(0,0,0,0)'),'42501');await db.exec('RESET ROLE');}
 await db.exec("UPDATE roles SET permissions='[]' WHERE id='rp'");await deny(()=>globalRead(radius),'42501');
 await db.exec("UPDATE licenses SET active=false WHERE organization_id='o1'");await deny(()=>read(),'42501');
 console.log(JSON.stringify({ok:true,checks,units:1002,fullSelectionAggregation:true}));
}finally{await db.close();}
