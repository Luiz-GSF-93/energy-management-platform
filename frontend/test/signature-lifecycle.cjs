const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Event','MouseEvent'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
process.env.NEXT_PUBLIC_API_URL='https://api.test.invalid';
const ui={Button:({children,variant,...p})=>React.createElement('button',{type:'button',...p},children),Alert:({children})=>React.createElement('div',{role:'alert'},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p)),Card:({title,children})=>React.createElement('section',null,React.createElement('h3',null,title),children)};
const original=Module._load;
Module._load=function(name,parent,main){if(name==='@/app/components/ui')return ui;if(name==='@/app/lib/auth/session')return {session:{getOrganizationSession:()=>null}};if(name==='@/app/lib/auth/renew')return {freshToken:async()=>'test-token',sessionAttention:()=>{}};if(name==='@/app/lib/api/client')return require('../app/lib/api/client.ts');return original.call(this,name,parent,main);};
const id='11111111-1111-4111-8111-111111111111',checkId='22222222-2222-4222-8222-222222222222',docId='33333333-3333-4333-8333-333333333333';
let enabled=false,stage='DRAFT',signedDocument=null,failFirst=true,posts=[],commands=[];
const actor={actor_name:null,currentActorName:'Current Owner'},eventHash='a'.repeat(64);
global.fetch=async(url,options)=>{
 if(options.method==='POST'){
  assert.equal(options.headers.get('Content-Type'),'application/json');assert.ok(options.headers.get('Authorization'));const body=JSON.parse(options.body);assert.equal(typeof body,'object');assert.equal(body.id,id);posts.push({url,body});
  if(failFirst){failFirst=false;throw Error('lost response');}
  if(url.endsWith('/commands'))commands.push({...actor,request_id:body.requestId,kind:body.kind,justification:body.justification,events:[{...actor,state:body.kind==='ACTIVATE'?'VERIFIED':'ACKNOWLEDGED',version:1,justification:body.justification}]});
  if(url.endsWith('/check')&&commands.some(c=>c.kind==='ACTIVATE'))stage='RUNNING';
  if(url.endsWith('/bridge'))signedDocument={id:docId,events:[{...actor,version:1,status:'IMPORTED',justification:'Fixture imported from authenticated provider.'}]};
  if(url.endsWith('/reviews'))signedDocument.events.push({...actor,version:body.expectedVersion+1,status:body.status,justification:body.justification});
  return {ok:true,status:200,json:async()=>({state:'VERIFIED'})};
 }
 const value={latestCheckId:checkId,total:1,page:0,capabilities:{reads:enabled,activation:enabled,notification:enabled},checks:[{...actor,request_id:checkId,created_at:new Date().toISOString(),justification:'Fixture private resource conference.',resolution:null,result:{proof:{status:stage,log:[]}},artifact:stage==='SIGNED'?{sha256:'b'.repeat(64)}:null,signedDocument}],commands,inbox:[{event_hash:eventHash,name:'document_closed',occurred_at:new Date().toISOString(),confirmed:false}]};
 return {ok:true,status:200,json:async()=>value};
};
const root=createRoot(document.getElementById('root'));
async function click(text){const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);assert.equal(b.disabled,false,text);await act(async()=>b.click());}
async function fill(value){const e=document.querySelector('input:not([type="checkbox"])');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});}
async function tick(prefix){const label=[...document.querySelectorAll('label')].find(x=>x.textContent.includes(prefix));assert.ok(label,prefix);await act(async()=>label.querySelector('input[type="checkbox"]').click());}
(async()=>{try{
 await act(async()=>root.render(React.createElement(require('../app/backoffice/platform-sales/SignatureLifecycle.tsx').default,{id})));
 await click('Consultar fluxo de assinatura');assert.ok(document.body.textContent.includes('Consultas externas desligadas.'));assert.equal(document.querySelectorAll('button').length>0,true);assert.equal(posts.length,0);
 enabled=true;await click('Consultar fluxo de assinatura');await fill('Explicit private lifecycle fixture justification.');
 await click('Conferir recursos / recuperar ativação');await click('Consultar mesma requisição');assert.deepEqual(posts[0],posts[1]);
 await click('Consultar fluxo de assinatura');const activation=[...document.querySelectorAll('button')].find(x=>x.textContent==='Ativar envelope sandbox');assert.equal(activation.disabled,true);
 await tick('Conferi a minuta e os destinatários');await click('Ativar envelope sandbox');assert.equal(posts.at(-1).body.kind,'ACTIVATE');await click('Consultar fluxo de assinatura');assert.equal([...document.querySelectorAll('button')].some(x=>x.textContent==='Ativar envelope sandbox'),false);await click('Conferir recursos / recuperar ativação');await click('Consultar fluxo de assinatura');await tick('Conferi a minuta e os destinatários');await click('Notificar participantes de teste');assert.equal(posts.at(-1).body.kind,'NOTIFY');
 await click('Consultar fluxo de assinatura');await click('Conferir evento na API');assert.equal(posts.at(-1).body.eventHash,eventHash);
 stage='SIGNED';await click('Consultar fluxo de assinatura');await click('Preservar para conferência do Owner');assert.equal(posts.at(-1).body.checkId,checkId);await click('Consultar fluxo de assinatura');
 for(const prefix of ['Partes e representantes','Escopo contratado','Preços conferidos','Assinaturas e poderes','Versão da minuta'])await tick(prefix);
 await click('Registrar conferência do Owner');assert.equal(posts.at(-1).body.status,'CHECKED');assert.equal(posts.at(-1).body.documentId,docId);await click('Consultar fluxo de assinatura');await click('Aceitar evidência documental sandbox');assert.equal(posts.at(-1).body.status,'ACCEPTED');await click('Consultar fluxo de assinatura');
 assert.ok(document.body.textContent.includes('Nome não disponível'));assert.ok(document.body.textContent.includes('Current Owner'));assert.ok(document.body.textContent.includes('Nenhum registro de teste libera licença real.'));assert.ok(document.body.textContent.includes(docId));
 assert.equal(posts.length,9);console.log('PASS: complete Owner UI, actual JSON transport, same-ID retry, explicit participant confirmation, pre-notification API check without webhook dependency, separate activation/notification, webhook confirmation, bridge and two-step review; calls off preserved.');
 }finally{await act(async()=>root.unmount());dom.window.close();Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
