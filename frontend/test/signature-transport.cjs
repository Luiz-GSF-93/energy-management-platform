const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Event','MouseEvent'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
process.env.NEXT_PUBLIC_API_URL='https://api.test.invalid';
const ui={Button:({children,variant,...p})=>React.createElement('button',{type:'button',...p},children),Alert:({children})=>React.createElement('div',{role:'alert'},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p)),Card:({title,children})=>React.createElement('section',null,title,children)};
const original=Module._load;
Module._load=function(name,parent,main){
 if(name==='@/app/components/ui')return ui;
 if(name==='@/app/lib/auth/session')return {session:{getOrganizationSession:()=>null}};
 if(name==='@/app/lib/auth/renew')return {freshToken:async()=>'test-token',sessionAttention:()=>{}};
 if(name==='@/app/lib/api/client')return require('../app/lib/api/client.ts');
 if(name==='../contracts/WorkflowModal')return {__esModule:true,default:({children})=>React.createElement('div',null,children)};
 return original.call(this,name,parent,main);
};
const id='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222',candidate='33333333-3333-4333-8333-333333333333';
const attempts=[{lease,step:'DOCUMENT',events:[{state:'UNKNOWN'}]}];
let posts=[],failOriginal=true,enabled=true;
global.fetch=async(url,options)=>{
 if(options.method==='POST'){
  assert.equal(options.headers.get('Content-Type'),'application/json');
  const body=JSON.parse(options.body);assert.equal(typeof body,'object');assert.equal(Array.isArray(body),false);
  posts.push({url,body});
  if(url.endsWith('/original/check')&&failOriginal){failOriginal=false;throw Error('uncertain response');}
  return {ok:true,status:200,json:async()=>({id,state:'VERIFIED'})};
 }
 let value={rows:[],total:0,page:0,callsEnabled:enabled};
 if(url.includes('/creation'))value={nextOrdinal:1,completed:false,blocked:false,callsEnabled:enabled,attempts:[]};
 if(url.endsWith('/'+id))value={request:{id,draft_id:candidate,draft_sha256:'a'.repeat(64),snapshot:{parties:{}},environment:'SANDBOX',provider:'CLICKSIGN'},events:[{version:1,state:'PREPARED'}]};
 return {ok:true,status:200,json:async()=>value};
};
const root=createRoot(document.getElementById('root'));
async function click(text){const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);assert.equal(b.disabled,false);await act(async()=>b.click());}
async function fill(label,value){const e=[...document.querySelectorAll('label')].find(x=>x.firstChild.textContent===label).querySelector('input,select');assert.ok(e,label);await act(async()=>{Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
async function screen(name,props){await act(async()=>root.render(React.createElement(require('../app/backoffice/platform-sales/'+name+'.tsx').default,{key:name,...props})));}
(async()=>{try{
 await screen('SignatureOriginal',{id,attempts});await click('Consultar conferências do PDF');
 await fill('Tentativa de documento',lease);await fill('ID do documento na Clicksign sandbox',candidate);await fill('Justificativa da conferência do PDF','Private original comparison fixture.');
 await click('Conferir original por download');await click('Consultar mesma requisição');
 assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0].body.candidateId,candidate);assert.match(posts[0].body.requestId,/^[a-f0-9-]{36}$/);
 enabled=false;await click('Consultar conferências do PDF');assert.ok(document.body.textContent.includes('Downloads externos desligados'));assert.equal(posts.length,2);enabled=true;
 await screen('SignatureCreation',{id});await click('Consultar criação');await fill('Justificativa do passo sandbox','Private creation fixture justification.');await click('Criar próximo recurso de teste');assert.equal(posts.at(-1).body.expectedOrdinal,1);
 await screen('SignatureRecovery',{id,attempts:[{lease,step:'ENVELOPE',events:[{state:'UNKNOWN'}]}]});await click('Consultar reconferências');await fill('Tentativa incerta',lease);await fill('ID do recurso existente na Clicksign sandbox',candidate);await fill('Justificativa da reconferência','Private recovery fixture justification.');await click('Reconferir por consulta');assert.equal(posts.at(-1).body.lease,lease);
 await screen('SignaturePreparation',{});const details=document.querySelector('details');await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});await click('Inserir preparação');await fill('ID da minuta aprovada',candidate);await fill('SHA-256 do PDF preservado','a'.repeat(64));await fill('Justificativa de homologação','Private preparation fixture justification.');await click('Preservar preparação');assert.equal(posts.at(-1).body.draftId,candidate);
 await fill('Justificativa de retirada','Private withdrawal fixture justification.');await click('Retirar preparação');assert.equal(posts.at(-1).body.expectedVersion,1);
 assert.equal(posts.length,6);console.log('PASS: six signature commands use actual object JSON transport; original retry and disabled downloads preserved.');
 }finally{await act(async()=>root.unmount());dom.window.close();Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
