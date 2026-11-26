import test from 'node:test';
import assert from 'node:assert/strict';
import {createDisabledServer} from './disabled-mode.mjs';

test('disabled service reports no readiness and blocks reads and writes',async()=>{
  const server=createDisabledServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const health=await fetch(base+'/health');
    assert.equal(health.status,200);
    const state=await health.json();
    assert.equal(state.enabled,false);
    assert.equal(state.ready,false);
    for(const [method,path] of [['GET','/v1/license-requests/example/access'],['POST','/v1/license-requests'],['POST','/v1/core/signature-events']]){
      const r=await fetch(base+path,{method});
      assert.equal(r.status,503);
      assert.equal((await r.json()).error,'PEE_CORE_DISABLED');
    }
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});
