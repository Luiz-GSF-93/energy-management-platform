// Run after npm run build in backend. No production connection is used.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ConsumerUnitsService } = require('../../dist/modules/consumer-units/services/consumer-units.service.js');
const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const migration = readFileSync(new URL('../../src/database/migrations/20260924_f1_7_consumer_unit_metadata.sql', import.meta.url), 'utf8');
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
    try { const result = await db.query(sql, params); return { data: result.rows[0] || null, error: null }; }
    catch (error) { return { data: null, error }; }
  }
}

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  for (const table of ['customers', 'consumer_units']) {
    const columns = fixture.columns.filter(c => c.table === table).map(c => `${q(c.name)} ${c.type}${c.not_null ? ' NOT NULL' : ''}${c.default ? ' DEFAULT ' + c.default : ''}`);
    await db.exec(`CREATE TABLE ${q(table)} (${columns.join(',')}, PRIMARY KEY(id)); ALTER TABLE ${q(table)} ENABLE ROW LEVEL SECURITY; GRANT ALL ON ${q(table)} TO service_role;`);
  }
  await db.exec(`ALTER TABLE consumer_units ADD FOREIGN KEY(customer_id) REFERENCES customers(id), ADD UNIQUE(organization_id,consumer_unit_number),
    ADD CHECK (status IN ('ACTIVE','INACTIVE','MIGRATED','CHURN','SEASONAL')),
    ADD CHECK (tariff_modality IN ('BLUE','GREEN','WHITE','CONVENTIONAL'));`);
  await db.exec(migration);
  await db.exec(migration);
  ok(true, 'migration safely repeats');
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  await db.exec(`INSERT INTO customers(id,organization_id,company_name,document) VALUES ('${a}','org-a','A','A'),('${b}','org-b','B','B'); SET ROLE service_role;`);
  const service = new ConsumerUnitsService({ getClient: () => ({ from: table => new Query(table) }) });
  const body = { customerId: a, name: 'Factory', code: 'UC-001', distributor: 'Distributor', tariffGroup: 'A4', installedCapacity: 100, contractedDemand: 80 };
  const unitA = await service.create(body, 'org-a');
  const unitB = await service.create({ ...body, customerId: b }, 'org-b');
  ok(unitA.customer_id === a && unitA.organization_id === 'org-a', 'parent and tenant persisted');
  ok(unitA.consumer_unit_number === 'UC-001' && unitA.tariff_group === 'A4', 'mapped columns persisted');
  ok(unitA.tariff_modality === 'BLUE' && unitA.status === 'ACTIVE', 'database defaults preserved');
  ok(unitA.installed_capacity === 100 && unitA.contracted_demand === 80, 'capacity differs from demand');
  ok(unitA.id !== unitB.id, 'same unit number can exist in different organizations');
  const denied = async (action, status) => { await assert.rejects(action, error => error.getStatus?.() === status); checks++; };
  await denied(() => service.create(body, 'org-b'), 404);
  await denied(() => service.create(body, 'org-a'), 409);
  await denied(() => service.findOne(unitB.id, 'org-a'), 404);
  await denied(() => service.update(unitB.id, 'org-a', { name: 'injected' }), 404);
  await denied(() => service.delete(unitB.id, 'org-a'), 404);
  await denied(() => service.update(unitA.id, 'org-a', { organization_id: 'org-b' }), 400);
  await denied(() => service.update(unitA.id, 'org-a', { tariffGroup: null }), 400);
  await denied(() => service.create({ ...body, distributor: undefined }, 'org-a'), 400);
  const updated = await service.update(unitA.id, 'org-a', { name: 'Updated', address: null, installedCapacity: 0 });
  ok(updated.name === 'Updated' && updated.address === null && updated.installed_capacity === 0 && updated.contracted_demand === 80, 'update and explicit clearing round trip');
  ok((await service.findOne(unitB.id, 'org-b')).name === 'Factory', 'other tenant unchanged');
  await db.exec(`UPDATE customers SET deleted_at=now() WHERE id='${a}'`);
  await denied(() => service.create({ ...body, code: 'UC-002' }, 'org-a'), 404);
  ok((await db.query('SELECT count(*)::int AS n FROM consumer_units')).rows[0].n === 2, 'failed writes did not create rows');
  await service.delete(unitA.id, 'org-a');
  await denied(() => service.findOne(unitA.id, 'org-a'), 404);
  await db.exec('RESET ROLE');
  const grants = await db.query("SELECT has_column_privilege('anon','consumer_units','name','SELECT') AS anon,has_column_privilege('authenticated','consumer_units','installed_capacity','UPDATE') AS authenticated");
  ok(!grants.rows[0].anon && !grants.rows[0].authenticated, 'new columns do not reopen browser access');
  console.log(JSON.stringify({ status: 'passed', checks, engine: (await db.query('SELECT version()')).rows[0].version }, null, 2));
} finally { await db.close(); }
