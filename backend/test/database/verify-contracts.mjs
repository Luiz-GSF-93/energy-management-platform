// Run after npm run build in backend. No production connection is used.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ContractsService } = require('../../dist/modules/contracts/services/contracts.service.js');
const fixture = JSON.parse(readFileSync(new URL('./contracts-fixture.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const migration = readFileSync(new URL('../../src/database/migrations/20260924_f1_8_contract_notes.sql', import.meta.url), 'utf8');
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
  for (const table of ['customers', 'consumer_units', 'management_contracts', 'energy_contracts']) {
    const columns = fixture.columns.filter(c => c.table === table).map(c => `${q(c.name)} ${c.type}${c.not_null ? ' NOT NULL' : ''}${c.default ? ' DEFAULT ' + c.default : ''}`);
    await db.exec(`CREATE TABLE ${q(table)} (${columns.join(',')}, PRIMARY KEY(id)); ALTER TABLE ${q(table)} ENABLE ROW LEVEL SECURITY; GRANT ALL ON ${q(table)} TO service_role;`);
  }
  await db.exec(`ALTER TABLE energy_contracts ADD UNIQUE(contract_number), ADD FOREIGN KEY(customer_id) REFERENCES customers(id), ADD FOREIGN KEY(consumer_unit_id) REFERENCES consumer_units(id), ADD CHECK(contract_type IN ('ENERGY_PURCHASE','ENERGY_SALE','MANAGEMENT','INTERMEDIATION','OTHER')), ADD CHECK(status IN ('DRAFT','ACTIVE','APPROVED','PAUSED','TERMINATED','EXPIRED'));`);
  await db.exec(migration);
  await db.exec(migration);
  ok(true, 'migration safely repeats');
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  await db.exec(`INSERT INTO customers(id,organization_id,company_name,document) VALUES ('${a}','org-a','A','A'),('${b}','org-b','B','B'); INSERT INTO consumer_units(id,organization_id,customer_id,consumer_unit_number,distributor,tariff_group) VALUES ('${a}','org-a','${a}','A','D','A4'),('${b}','org-b','${b}','B','D','A4'); INSERT INTO management_contracts(id,organization_id,customer_id,contract_number,remuneration_model,start_date) VALUES ('${a}','org-a','${a}','M-A','FIXED','2026-01-01'),('${b}','org-b','${b}','M-B','FIXED','2026-01-01'); SET ROLE service_role;`);
  const service = new ContractsService({ getClient: () => ({ from: table => new Query(table) }) }, { requireEntitlement: async () => {} });
  const body = { consumerUnitId: a, contractNumber: 'C-A', contractType: 'ENERGY_PURCHASE', contractedVolumeMwh: 100, currentPrice: 250, startDate: '2026-01-01', endDate: '2026-12-31', notes: 'Terms', managementContractId: a };
  const row = await service.create(body, 'org-a');
  ok(row.customer_id === a && row.organization_id === 'org-a' && row.consumer_unit_id === a, 'scoped parent persisted');
  ok(row.contracted_volume_mwh === 100 && row.current_price === 250 && row.notes === 'Terms', 'required values and notes round trip');
  ok(row.status === 'DRAFT' && row.energy_type === 'ENERGY' && row.adjustment_frequency === 'ANNUAL', 'draft and database defaults');
  const denied = async (action, status) => { await assert.rejects(action, error => error.getStatus?.() === status); checks++; };
  await denied(() => service.create(body, 'org-b'), 404);
  await denied(() => service.create(body, 'org-a'), 409);
  await denied(() => service.create({ ...body, contractNumber: 'X', managementContractId: b }, 'org-a'), 404);
  for (const method of ['findOne','delete']) await denied(() => service[method](row.id, 'org-b'), 404);
  await denied(() => service.update(row.id, 'org-b', { currentPrice: 1 }), 404);
  await denied(() => service.create({ ...body, startDate: '2026-02-30' }, 'org-a'), 400);
  await denied(() => service.update(row.id, 'org-a', { endDate: '2025-01-01' }), 400);
  const draft = await service.update(row.id, 'org-a', { currentPrice: 200, notes: null });
  ok(draft.current_price === 200 && draft.notes === null, 'draft update and notes clearing');
  await service.update(row.id, 'org-a', { status: 'ACTIVE' });
  await denied(() => service.update(row.id, 'org-a', { currentPrice: 1 }), 409);
  await denied(() => service.delete(row.id, 'org-a'), 409);
  ok((await service.findOne(row.id, 'org-a')).current_price === 200, 'historical price preserved');
  const disposable = await service.create({ ...body, contractNumber: 'DRAFT-DELETE' }, 'org-a');
  await service.delete(disposable.id, 'org-a');
  await denied(() => service.findOne(disposable.id, 'org-a'), 404);
  await db.exec('RESET ROLE');
  const grants = await db.query("SELECT has_column_privilege('anon','energy_contracts','notes','SELECT') AS anon,has_column_privilege('authenticated','energy_contracts','notes','UPDATE') AS authenticated");
  ok(!grants.rows[0].anon && !grants.rows[0].authenticated, 'notes do not reopen browser access');
  console.log(JSON.stringify({ status: 'passed', checks, engine: (await db.query('SELECT version()')).rows[0].version }, null, 2));
} finally { await db.close(); }
