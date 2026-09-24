// Run after npm run build in backend. No production connection is used.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DocumentsService } = require('../../dist/modules/documents/services/documents.service.js');
const fixture = JSON.parse(readFileSync(new URL('./uploads-fixture.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const migration = readFileSync(new URL('../../src/database/migrations/20260924_f1_9_document_metadata.sql', import.meta.url), 'utf8');
const quotaMigration = readFileSync(new URL('../../src/database/migrations/20260924_f1_10_private_upload.sql', import.meta.url), 'utf8');
const db = new PGlite();
const q = name => '"' + name.replaceAll('"', '""') + '"';
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };

// A small Supabase-shaped adapter executes the real service's SQL payloads in
// PostgreSQL. It does not emulate Supabase HTTP/auth or replace end-to-end tests.
class Query {
  constructor(table) { this.table = table; this.filters = []; this.params = []; this.op = 'select'; }
  select() { return this; }
  eq(column, value) { this.params.push(value); this.filters.push(`${q(column)}=$${this.params.length}`); return this; }
  is(column, value) { assert.equal(value, null); this.filters.push(`${q(column)} IS NULL`); return this; }
  insert(rows) { this.op = 'insert'; this.values = rows[0]; return this; }
  update(values) { this.op = 'update'; this.values = values; return this; }
  delete() { this.op = 'delete'; return this; }
  async single() { return this.maybeSingle(); }
  async maybeSingle() {
    const params = [...this.params];
    const bind = value => { params.push(value); return `$${params.length}`; };
    const where = this.filters.length ? ' WHERE ' + this.filters.join(' AND ') : '';
    let sql;
    if (this.op === 'insert') sql = `INSERT INTO ${q(this.table)} (${Object.keys(this.values).map(q).join(',')}) VALUES (${Object.values(this.values).map(bind).join(',')}) RETURNING *`;
    else if (this.op === 'update') sql = `UPDATE ${q(this.table)} SET ${Object.entries(this.values).map(([k,v]) => `${q(k)}=${bind(v)}`).join(',')}${where} RETURNING *`;
    else if (this.op === 'delete') sql = `DELETE FROM ${q(this.table)}${where} RETURNING *`;
    else sql = `SELECT * FROM ${q(this.table)}${where}`;
    try { const result = await db.query(sql, params); return { data: result.rows[0] ? JSON.parse(JSON.stringify(result.rows[0])) : null, error: null }; }
    catch (error) { return { data: null, error }; }
  }
}

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  await db.exec("CREATE SCHEMA storage; CREATE TABLE storage.objects(bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO anon,authenticated; GRANT ALL ON storage.objects TO anon,authenticated; CREATE POLICY existing_other_bucket_access ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true); INSERT INTO storage.objects VALUES ('energy-documents-private'),('other');");
  await db.exec('CREATE TABLE users(auth_user_id uuid UNIQUE);');
  for (const table of ['customers','consumer_units','energy_contracts','documents','licenses']) {
    const columns = fixture.columns.filter(c => c.table === table).map(c => `${q(c.name)} ${c.type}${c.not_null ? ' NOT NULL' : ''}${c.default ? ' DEFAULT ' + c.default : ''}`);
    await db.exec(`CREATE TABLE ${q(table)} (${columns.join(',')}, PRIMARY KEY(id)); ALTER TABLE ${q(table)} ENABLE ROW LEVEL SECURITY; GRANT ALL ON ${q(table)} TO service_role;`);
  }
  for (const c of fixture.constraints) await db.exec(`ALTER TABLE documents ADD CONSTRAINT ${q(c.name)} ${c.definition}`);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(quotaMigration);
  await db.exec(quotaMigration);
  ok(true, 'migrations safely repeat');
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  await db.exec(`INSERT INTO users VALUES ('${a}'),('${b}'); INSERT INTO customers(id,organization_id,company_name,document) VALUES ('${a}','org-a','A','A'),('${b}','org-b','B','B'); INSERT INTO consumer_units(id,organization_id,customer_id,consumer_unit_number,distributor,tariff_group) VALUES ('${a}','org-a','${a}','A','D','A4'),('${b}','org-b','${b}','B','D','A4'); INSERT INTO energy_contracts(id,organization_id,customer_id,consumer_unit_id,contract_number,contract_type,contracted_volume_mwh,current_price,start_date,end_date) VALUES ('${a}','org-a','${a}','${a}','C-A','ENERGY_PURCHASE',100,200,'2026-01-01','2026-12-31'),('${b}','org-b','${b}','${b}','C-B','ENERGY_PURCHASE',100,200,'2026-01-01','2026-12-31'); INSERT INTO licenses(id,organization_id,license_type,documents_limit,renewal_date,start_date,end_date,status,active,document_management) VALUES ('license-a','org-a','TEST',3,'2999-01-01','1900-01-01','2999-01-01','ACTIVE',true,true),('license-b','org-b','TEST',3,'2999-01-01','1900-01-01','2999-01-01','ACTIVE',true,true); SET ROLE service_role;`);
  const service = new DocumentsService({ getClient: () => ({ from: table => new Query(table) }) }, { requireEntitlement: async () => {} });
  const body = { customerId: a, consumerUnitId: a, fileName: 'invoice.pdf', fileType: 'application/pdf', documentType: 'INVOICE_DISTRIBUTOR', referenceMonth: '2026-09-01', fileHash: 'a'.repeat(64), fileSizeBytes: 100, filePath: `org-a/${a}/invoice.pdf`, energyContractId: a };
  const row = await service.create(body, 'org-a', a);
  ok(row.customer_id === a && row.consumer_unit_id === a && row.organization_id === 'org-a' && row.energy_contract_id === a, 'scoped parent links persisted');
  ok(row.original_filename === body.fileName && row.file_hash === body.fileHash && row.file_size_bytes === 100 && row.mime_type === body.fileType, 'mapped file metadata');
  ok(row.uploaded_by_auth_user_id === a && row.license_check_passed === true, 'trusted uploader and entitlement');
  ok(row.processing_status === 'PENDING' && row.ocr_status === 'PENDING' && row.ocr_extracted_data === null, 'unverified metadata never marked processed');
  const denied = async (action, status) => { await assert.rejects(action, error => error.getStatus?.() === status); checks++; };
  await denied(() => service.create({ ...body, fileHash: 'A'.repeat(64) }, 'org-a', a), 409);
  const other = await service.create({ ...body, customerId: b, consumerUnitId: b, energyContractId: b, filePath: `org-b/${b}/invoice.pdf` }, 'org-b', b);
  ok(other.organization_id === 'org-b', 'same hash allowed in another organization');
  await denied(() => service.create({ ...body, filePath: `org-b/${a}/invoice.pdf` }, 'org-b', b), 404);
  await denied(() => service.create({ ...body, fileHash: 'b'.repeat(64), energyContractId: b }, 'org-a', a), 404);
  await denied(() => service.findOne(row.id, 'org-b'), 404);
  await denied(() => service.update(row.id, 'org-b', { description: 'changed' }), 404);
  await denied(() => service.delete(row.id, 'org-b'), 404);
  await denied(() => service.create({ ...body, ocrData: '{}' }, 'org-a', a), 400);
  await denied(() => service.create({ ...body, filePath: `org-a/${a}/../private.pdf` }, 'org-a', a), 400);
  const changed = await service.update(row.id, 'org-a', { description: 'Reviewed metadata' });
  ok(changed.description === 'Reviewed metadata', 'pending description round trip');
  const cleared = await service.update(row.id, 'org-a', { description: null });
  ok(cleared.description === null, 'description can be cleared');
  await denied(() => service.delete(row.id, 'org-a'), 409);
  await db.query('UPDATE documents SET processing_status=$1,ocr_status=$1 WHERE id=$2', ['COMPLETED',row.id]);
  await denied(() => service.update(row.id, 'org-a', { description: 'overwrite' }), 409);
  await denied(() => service.delete(row.id, 'org-a'), 409);
  ok((await service.findOne(other.id, 'org-b')).description === null, 'other tenant unchanged');
  await db.exec(`UPDATE customers SET deleted_at=now() WHERE id='${a}'`);
  await denied(() => service.create({ ...body, fileHash: 'b'.repeat(64) }, 'org-a', a), 404);
  await db.exec("UPDATE customers SET deleted_at=NULL; UPDATE licenses SET documents_limit=2 WHERE organization_id='org-a'");
  ok((await db.query("SELECT documents_used FROM licenses WHERE id='license-a'")).rows[0].documents_used === 1, 'rejected duplicate does not consume quota');
  const attempts = await Promise.allSettled(['c','d'].map(hash => service.create({ ...body, fileHash: hash.repeat(64) }, 'org-a', a)));
  ok(attempts.filter(r=>r.status==='fulfilled').length===1, 'only one concurrent final quota slot is consumed');
  ok(attempts.filter(r=>r.status==='rejected' && r.reason.getStatus()===403).length===1, 'over-quota upload denied');
  ok((await db.query("SELECT documents_used FROM licenses WHERE id='license-a'")).rows[0].documents_used === 2, 'quota counter remains exact');
  await db.exec("UPDATE licenses SET active=false WHERE id='license-b'");
  await denied(()=>service.create({...body,customerId:b,consumerUnitId:b,energyContractId:b,filePath:'org-b/'+b+'/new.pdf',fileHash:'f'.repeat(64)},'org-b',b),403);
  await db.exec('RESET ROLE');
  const grants = await db.query("SELECT has_any_column_privilege('anon','documents','SELECT,INSERT,UPDATE') AS anon,has_any_column_privilege('authenticated','documents','SELECT,INSERT,UPDATE') AS authenticated");
  ok(!grants.rows[0].anon && !grants.rows[0].authenticated, 'new columns preserve browser isolation');
  await db.exec('SET ROLE authenticated');
  ok((await db.query("SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id='energy-documents-private'")).rows[0].n===0, 'restrictive policy blocks direct authenticated access');
  ok((await db.query("SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id='other'")).rows[0].n===1, 'other bucket policies unchanged');
  await db.exec('RESET ROLE');
  console.log(JSON.stringify({ status: 'passed', checks, engine: (await db.query('SELECT version()')).rows[0].version }, null, 2));
} finally { await db.close(); }
