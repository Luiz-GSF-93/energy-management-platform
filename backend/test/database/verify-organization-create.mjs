import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++};
const migration=readFileSync(new URL('../../src/database/migrations/20260924_f1_12_organization_create_repair.sql',import.meta.url),'utf8');
const old=readFileSync(new URL('../../src/database/migrations/20260923_p2_3a_5_organization_rbac_provisioning.sql',import.meta.url),'utf8');
const codes=[...new Set([...old.matchAll(/\('(admin_org|gestor|operacional|consulta)', '([^']+)'\)/g)].map(x=>x[2]))];
try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE permissions(id text PRIMARY KEY,code text UNIQUE);CREATE TABLE organizations(id text PRIMARY KEY,name text,description text,created_at timestamp,updated_at timestamp,deleted_at timestamptz);CREATE TABLE roles(id text PRIMARY KEY,organization_id text REFERENCES organizations(id),name text,permissions jsonb,created_at timestamp,updated_at timestamp,scope varchar);`);
for(const [i,c] of codes.entries())await db.query('INSERT INTO permissions VALUES($1,$2)',[String(i),c]);
await db.exec(migration);await db.exec(migration);
await db.exec('BEGIN');
for(const id of ['a','b']){const r=(await db.query('SELECT * FROM create_organization_with_canonical_rbac($1,$2,$3)',[id,' Test ',' desc '])).rows[0];ok(r.role_count===4&&r.organization_name==='Test'&&r.organization_description==='desc','creation and normalized return');}
ok((await db.query('SELECT count(*)::int n FROM roles')).rows[0].n===8,'two organizations in same transaction');
const counts=(await db.query("SELECT name,jsonb_array_length(permissions) n FROM roles WHERE organization_id='a' ORDER BY name")).rows;
assert.deepEqual(counts.map(x=>[x.name,x.n]),[['admin_org',53],['consulta',12],['gestor',39],['operacional',26]]);checks++;
await db.exec('COMMIT');
await assert.rejects(()=>db.query("SELECT * FROM create_organization_with_canonical_rbac('a','dup',null)"),e=>e.code==='P3111');checks++;
await db.exec("DELETE FROM permissions WHERE code='documents.documents.upload'");
await assert.rejects(()=>db.query("SELECT * FROM create_organization_with_canonical_rbac('broken','broken',null)"),e=>e.code==='P3103');checks++;
ok((await db.query("SELECT count(*)::int n FROM organizations WHERE id='broken'")).rows[0].n===0,'no partial organization');
ok((await db.query("SELECT count(*)::int n FROM roles WHERE organization_id='broken'")).rows[0].n===0,'no partial roles');
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(()=>db.query("SELECT * FROM create_organization_with_canonical_rbac('blocked','blocked',null)"),e=>e.code==='42501');checks++;await db.exec('RESET ROLE');}
ok((await db.query("SELECT has_function_privilege('service_role','create_organization_with_canonical_rbac(text,text,text)','EXECUTE') ok")).rows[0].ok,'backend allowed');
ok(!(await db.query("SELECT has_function_privilege('service_role','resolve_canonical_organization_rbac()','EXECUTE') ok")).rows[0].ok,'internal resolver restricted');
console.log('PASS',checks,'organization provisioning checks');
}finally{await db.close()}
