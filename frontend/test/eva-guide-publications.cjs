// Synthetic authenticated DOM only. No live publication, network or account changes.
const fs=require('node:fs'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','FormData'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
let api;const old=Module._load;
Module._load=function(n,p,m){if(n==='@/app/lib/api/client')return {apiRequest:(...x)=>api(...x)};if(n==='@/app/components/ui')return Object.assign({},...['Button','Card','Input','Alert'].map(x=>require('../app/components/ui/'+x+'.tsx')));return old.call(this,n,p,m)};
const Guides=require('../app/backoffice/eva-knowledge/GuidePublications.tsx').default,root=createRoot(document.getElementById('root'));
const hash='a'.repeat(64),id='00000000-0000-4000-8000-000000000001';
const row={key:'guide-client-units',title:'Clientes e unidades',version:'1',release:'energyos-product-guides-v1',state:'DRAFT',eventId:null};
const detail={guide:{key:row.key,content:{title:row.title,questions:['Como cadastrar um cliente?'],steps:['Abra Clientes e unidades da organização ativa.','Confira a identificação antes de salvar.'],limits:['O guia não executa ações nem concede acesso.'],links:[]},roles:['admin_org'],permissions:['synthetic-permission'],modules:['bot_energy_rag'],codeSnapshots:[{path:'synthetic/code.ts',sha256:hash}],revision:{version:'1',hash,contentHash:hash,productRelease:row.release}},currentState:'DRAFT',publication:null,history:[],historyPage:0,historyTotal:0};
const click=async name=>act(async()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===name);assert.ok(b,name);b.click()});
(async()=>{try{
 let calls=[];api=async(p,o)=>{calls.push([p,o]);return o?.method==='POST'?{state:'PUBLISHED'}:p.includes('/guide-')?detail:{rows:[row],total:8,page:0,pageSize:5}};
 await act(async()=>root.render(React.createElement(Guides)));fs.writeFileSync('/tmp/eva-publication-preview-list.html',document.getElementById('root').innerHTML);assert.ok(document.body.textContent.includes('Página 1'));await click('Próxima');assert.ok(calls.at(-1)[0].includes('page=1'));await click('Anterior');await click('Detalhes');assert.ok(document.querySelector('dialog').open);assert.ok(document.body.textContent.includes(hash));
 fs.writeFileSync('/tmp/eva-publication-preview-modal.html',document.getElementById('root').innerHTML);
 const form=document.querySelector('dialog form');form.querySelector('textarea').value='Conferência sintética dos textos e limites.';form.querySelector('input').checked=true;
 await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 const sent=calls.find(x=>x[1]?.method==='POST');assert.ok(sent[0].endsWith('/publish'));assert.equal(sent[1].body.expectedDocumentHash,hash);assert.equal(sent[1].body.expectedEventId,null);assert.equal(Object.keys(sent[1].body).length,4);assert.equal(document.querySelector('dialog'),null);
 let fail=true;const published={...detail,currentState:'PUBLISHED',publication:{id,event_id:id,state:'PUBLISHED'},history:[{id,state:'PUBLISHED',actor_id:id,created_at:'2026-10-12T12:00:00Z',justification:'Conferência sintética'}],historyTotal:11};
 api=async(p,o)=>{calls.push([p,o]);if(o?.method==='POST'){if(fail)throw Error('Falha transitória');return {state:'QUARANTINED'}}return p.includes('/guide-')?published:{rows:[{...row,state:'PUBLISHED'}],total:1,page:0,pageSize:5}};
 await click('Atualizar');await click('Detalhes');assert.ok(document.body.textContent.includes('Histórico · 11'));await click('Próximo histórico');assert.ok(calls.at(-1)[0].includes('page=1'));await click('Histórico anterior');
 const qform=document.querySelector('dialog form');qform.querySelector('textarea').value='Quarentena sintética para conferir recuperação.';qform.querySelector('input').checked=true;
 await act(async()=>qform.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.ok(document.body.textContent.includes('Falha transitória'));const first=calls.at(-1)[1].body;
 fail=false;await act(async()=>qform.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.deepEqual(calls.filter(x=>x[1]?.method==='POST').at(-1)[1].body,first);assert.ok(document.body.textContent.includes('Quarentena'));
 await act(async()=>root.unmount());console.log('PASS: list/pagination/modal/history, pinned version, quarantine and idempotent retry');
 }catch(e){console.error(e);process.exitCode=1}})();
