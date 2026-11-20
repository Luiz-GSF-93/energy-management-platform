import test from 'node:test';
import assert from 'node:assert/strict';
import {supabaseServerHeaders} from './supabase-auth.mjs';

test('modern Supabase server keys are sent in apikey, never as a JWT',()=>{
  const key='sb_secret_test_fixture_not_a_real_credential';
  const h=supabaseServerHeaders({SUPABASE_SERVER_KEY:key});
  assert.equal(h.apikey,key);
  assert.equal(h.Authorization,undefined);
});

test('legacy service_role compatibility does not accept an anon JWT',()=>{
  const token=role=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.fixture';
  const key=token('service_role');
  assert.equal(supabaseServerHeaders({SUPABASE_SERVICE_ROLE_KEY:key}).Authorization,'Bearer '+key);
  assert.throws(()=>supabaseServerHeaders({SUPABASE_SERVER_KEY:token('anon')}));
  assert.throws(()=>supabaseServerHeaders({SUPABASE_SERVER_KEY:'sb_publishable_fixture'}));
  assert.throws(()=>supabaseServerHeaders({}));
});
