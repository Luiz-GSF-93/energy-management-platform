import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const migration = readFileSync(process.argv[2], 'utf8');
const db = new PGlite();
let assertions = 0;
const ok = (value, message) => { assert.ok(value, message); assertions++; };
const q = name => '"' + name.replaceAll('"', '""') + '"';
const identityA = '00000000-0000-4000-8000-000000000001';
const identityB = '00000000-0000-4000-8000-000000000002';
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE TABLE public.organizations(id text);
    CREATE FUNCTION public.is_active_org_member(target_organization_id text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT false $$;`);
  const tables = [...new Set(fixture.columns.map(c => c.table))];
  // Reduced schema: real names/types/policies/function/view definitions, but no
  // production data or full FK/default/extension setup. Tests target privileges.
  for (const table of tables) {
    const cols = fixture.columns.filter(c => c.table === table).map(c => `${q(c.name)} ${c.type}`);
    await db.exec(`CREATE TABLE public.${q(table)} (${cols.join(',')});
      ALTER TABLE public.${q(table)} ENABLE ROW LEVEL SECURITY;
      GRANT ALL ON public.${q(table)} TO anon, authenticated, service_role;`);
  }
  for (const policy of fixture.policies) {
    await db.exec(`CREATE POLICY ${q(policy.policyname)} ON public.${q(policy.tablename)}
      AS ${policy.permissive} FOR ${policy.cmd} TO ${policy.roles.map(q).join(',')}
      ${policy.qual ? 'USING (' + policy.qual + ')' : ''}
      ${policy.with_check ? 'WITH CHECK (' + policy.with_check + ')' : ''};`);
  }
  for (const fn of fixture.routines) await db.exec(fn.definition);
  await db.exec(`CREATE VIEW public.v_expiring_contracts AS ${fixture.view};
    GRANT ALL ON public.v_expiring_contracts TO anon, authenticated, service_role;
    INSERT INTO public.customers(id,organization_id,company_name) VALUES ('c-a','a','A'),('c-b','b','B');
    INSERT INTO public.consumer_units(id,organization_id,customer_id,consumer_unit_number)
      VALUES ('u-a','a','c-a','A'),('u-b','b','c-b','B');
    INSERT INTO public.energy_contracts(id,organization_id,customer_id,consumer_unit_id,contract_number,status,end_date)
      VALUES ('e-a','a','c-a','u-a','A','ACTIVE',now()+interval '1 day'),('e-b','b','c-b','u-b','B','ACTIVE',now()+interval '1 day');
    INSERT INTO public.user_profiles(id,user_id,organization_id,name)
      VALUES ('p-a','${identityA}','a','A'),('p-b','${identityB}','b','B');
    INSERT INTO public.roles(id,organization_id,name,permissions) VALUES ('r-a','a','gestor','[]');
    GRANT UPDATE(organization_id) ON public.user_profiles TO authenticated;
    GRANT SELECT(company_name) ON public.customers TO authenticated;`);
  // Prove the original view's behavior before changing the boundary.
  await db.exec('SET ROLE anon');
  ok((await db.query('SELECT * FROM public.v_expiring_contracts')).rows.length === 2,
    'baseline view reproduces access to both tenants');
  await db.exec('RESET ROLE');
  await db.exec(migration);
  await db.exec(migration); // Safe retry must not reopen privileges.
  assertions++;

  const denied = async sql => {
    let error;
    try { await db.exec(sql); } catch (e) { error = e; }
    ok(error?.code === '42501', `expected permission denial for ${sql}; got ${error?.message}`);
  };
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await denied('SELECT * FROM public.v_expiring_contracts');
    for (const table of ['customers','consumer_units','energy_contracts','documents','invoices']) {
      await denied(`SELECT * FROM public.${table}`);
      await denied(`INSERT INTO public.${table}(organization_id) VALUES ('b')`);
      await denied(`UPDATE public.${table} SET organization_id='b'`);
      await denied(`DELETE FROM public.${table}`);
    }
    for (const table of ['roles','role_permissions','user_roles','organization_members']) {
      await denied(`DELETE FROM public.${table}`);
    }
    await denied("UPDATE public.roles SET permissions='[\"injected\"]'");
    await denied("UPDATE public.user_profiles SET organization_id='b'");
    await denied("UPDATE public.user_profiles SET role_id='r-a'");
    await denied("UPDATE public.user_profiles SET affiliation_type='internal'");
    const grant = await db.query(`SELECT has_function_privilege(current_user,
      (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='insert_calculation_validation'),'EXECUTE') AS allowed`);
    ok(grant.rows[0].allowed === false, 'legacy validation RPC is not browser-callable');
    await db.exec('RESET ROLE');
  }
  for (const [id, label] of [[identityA,'A'],[identityB,'B']]) {
    await db.exec(`SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
    const rows = (await db.query('SELECT * FROM public.user_profiles')).rows;
    ok(rows.length === 1 && rows[0].user_id === id, 'profile read is own-only and non-recursive');
    await db.exec(`UPDATE public.user_profiles SET name='${label} updated',avatar_url='avatar.png' WHERE user_id='${id}'`);
    const changed = await db.query('SELECT name FROM public.user_profiles');
    ok(changed.rows[0].name === `${label} updated`, 'own presentation update allowed');
    await db.exec('RESET ROLE');
  }
  await db.exec(`SET ROLE service_role;
    UPDATE public.customers SET company_name='Backend update' WHERE id='c-a';
    UPDATE public.roles SET permissions='["allowed"]' WHERE id='r-a';`);
  ok((await db.query('SELECT * FROM public.v_expiring_contracts')).rows.length === 2,
    'backend service keeps access');
  await db.exec('RESET ROLE');
  const opts = await db.query("SELECT reloptions FROM pg_class WHERE oid='public.v_expiring_contracts'::regclass");
  ok(opts.rows[0].reloptions.includes('security_invoker=true'), 'view uses invoker permissions');

  // Schema drift must fail atomically; no partial policy changes may persist.
  await db.exec('CREATE POLICY unexpected_profile_policy ON public.user_profiles FOR SELECT TO authenticated USING (false)');
  let driftFailed = false;
  try { await db.exec(migration); } catch { driftFailed = true; await db.exec('ROLLBACK'); }
  ok(driftFailed, 'unknown profile policy blocks migration');
  ok((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname='unexpected_profile_policy'")).rows[0].n === 1,
    'failed migration rolls back');
  console.log(JSON.stringify({ status: 'passed', assertions, engine: (await db.query('SELECT version()')).rows[0].version }, null, 2));
} finally { await db.close(); }
