import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite(); let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++};
const migration=readFileSync(new URL('../../src/database/migrations/20260924_f1_23c_legacy_organization_rbac.sql',import.meta.url),'utf8');
try {
await db.exec(`CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz); CREATE TABLE roles(id text PRIMARY KEY,organization_id text NOT NULL,name text NOT NULL,permissions jsonb,scope text); CREATE TABLE user_roles(user_id text,role_id text); CREATE TABLE organization_members(id text PRIMARY KEY,user_id uuid,organization_id text,role_id text,status text); CREATE TABLE audit_logs(id text,organization_id text,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text); CREATE FUNCTION resolve_canonical_organization_rbac() RETURNS TABLE(role_name text,permission_ids jsonb) LANGUAGE sql AS $$ VALUES ('admin_org','["admin"]'::jsonb),('gestor','["manager"]'::jsonb),('operacional','["operator"]'::jsonb),('consulta','["read"]'::jsonb) $$;`);
await db.exec(`INSERT INTO organizations VALUES('org_default',null),('1ed1c75e-55f8-402d-9046-ac3d446b406a',null),('unrelated',null); INSERT INTO roles VALUES('global','org_default','admin_platform','["global"]','global'),('local','org_default','admin_org','["custom-admin"]','organization'),('reader','org_default','consulta','["read"]','organization'); INSERT INTO user_roles VALUES('11111111-1111-4111-8111-111111111111','global'); INSERT INTO organization_members VALUES('legacy','11111111-1111-4111-8111-111111111111','org_default','global','active'),('existing','22222222-2222-4222-8222-222222222222','org_default','reader','inactive');`);
await db.exec(migration);
ok((await db.query("SELECT count(*)::int n FROM roles WHERE organization_id='1ed1c75e-55f8-402d-9046-ac3d446b406a' AND scope='organization'")).rows[0].n===4,'missing canonical roles created');
ok((await db.query("SELECT role_id,status FROM organization_members WHERE id='legacy'")).rows[0].role_id==='global','legacy global membership preserved');
ok((await db.query("SELECT status FROM organization_members WHERE id='existing'")).rows[0].status==='inactive','inactive member preserved');
ok((await db.query("SELECT permissions FROM roles WHERE id='local'")).rows[0].permissions[0]==='custom-admin','custom permissions preserved');
ok((await db.query("SELECT role_id FROM user_roles")).rows[0].role_id==='global','global assignment preserved');
ok((await db.query("SELECT count(*)::int n FROM roles WHERE organization_id='unrelated'")).rows[0].n===0,'unrelated organization untouched');
ok((await db.query("SELECT count(*)::int n FROM organization_members")).rows[0].n===2,'no members added');
const before=(await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n;
await db.exec(migration);
ok((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n===before,'idempotent without duplicate audits');
console.log('PASS',checks,'legacy RBAC repair checks');
} finally {await db.close()}
