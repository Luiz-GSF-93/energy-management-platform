const fs=require('node:fs');
const setup=fs.readFileSync('test/signature-transport.cjs','utf8');
const index=setup.indexOf("const id='11111111-");if(index<0)throw Error('Frontend fixture point changed');
const test=String.raw`
const id='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222',checkId='33333333-3333-4333-8333-333333333333',account='44444444-4444-4444-8444-444444444444';
let posts=[],enabled=false,application=false,resolution=null,fail=false;
global.fetch=async(url,options)=>{
 if(options.method==='POST'){const body=JSON.parse(options.body);assert.equal(typeof body,'object');assert.equal(options.headers.get('Content-Type'),'application/json');posts.push({url,body});if(fail)throw Error('lost result');return {ok:true,status:200,json:async()=>({state:'EMPTY'})};}
 return {ok:true,status:200,json:async()=>({page:0,total:1,callsEnabled:enabled,executionEnabled:application,diagnostics:[],rows:[{id:checkId,account_key:account,actor_name:'Original Owner',currentActorName:'Renamed Owner',justification:'Fixture evidence',outcome:{proof:{state:'EMPTY',reason:null,candidateIds:[]}},resolution}]})};
};
const root=createRoot(document.getElementById('root'));
async function click(text){const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);assert.equal(b.disabled,false);await act(async()=>b.click());}
async function fill(label,value){const e=[...document.querySelectorAll('label')].find(x=>x.firstChild.textContent===label).querySelector('input,select');await act(async()=>{Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
(async()=>{try{
 await act(async()=>root.render(React.createElement(require('../app/backoffice/platform-sales/SignatureAbsence.tsx').default,{id,attempts:[{lease,step:'ENVELOPE',events:[{state:'UNKNOWN'}]}]})));
 await click('Consultar recuperação por ausência');assert.ok(document.body.textContent.includes('Aplicação da recuperação desligada'));assert.ok(document.body.textContent.includes('Original Owner'));assert.ok(document.body.textContent.includes('Renamed Owner'));assert.equal(posts.length,0);
 await fill('Justificativa da recuperação','Owner-reviewed private recovery fixture.');await fill('Protocolo da confirmação escrita da Clicksign','FIXTURE-CLICK-123');
 assert.equal([...document.querySelectorAll('button')].find(x=>x.textContent==='Autorizar recuperação de uso único').disabled,true);
 await act(async()=>document.querySelector('input[type=checkbox]').click());await click('Autorizar recuperação de uso único');assert.equal(posts[0].body.accountKey,account);assert.equal(posts[0].body.checkId,checkId);assert.equal(posts[0].body.providerReference,'FIXTURE-CLICK-123');
 enabled=true;await click('Consultar recuperação por ausência');await fill('Tentativa de envelope incerta',lease);await click('Reconferir referência sandbox');assert.equal(posts[1].body.lease,lease);assert.equal(posts[1].body.id,id);
 resolution={id:checkId,provider_reference:'FIXTURE-CLICK-123',events:[{state:'AUTHORIZED'}]};await click('Consultar recuperação por ausência');
 assert.equal([...document.querySelectorAll('button')].find(x=>x.textContent==='Reconferir e criar envelope uma vez').disabled,true);
 fail=true;await click('Retirar autorização');assert.equal(posts[2].body.resolutionId,checkId);assert.ok(document.body.textContent.includes('Resultado não confirmado'));assert.equal(document.querySelectorAll('button').length,1);assert.equal(posts.some(x=>x.url.endsWith('/execute')),false);
 console.log('PASS: absence frontend object transport, explicit confirmation, historical/current names, disabled execution and no automatic retry.');
 }finally{await act(async()=>root.unmount());dom.window.close();Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
`;
new Function('require',setup.slice(0,index)+test)(require);
