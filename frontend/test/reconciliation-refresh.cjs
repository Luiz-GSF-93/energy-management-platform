/* Controlled API and DOM only; no production writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid',pretendToBeVisual:true});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','Event','MouseEvent','FormData'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let pending=[],calls=[],editable=true;const original=Module._load;
Module._load=function(name,parent,main){
 if(name==='@/app/lib/api/client')return {apiRequest:(url,options)=>{calls.push({url,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 if(name==='@/app/providers')return {useAuth:()=>({context:{scope:'organization',currentOrganization:{id:'org-test'}},hasPermission:p=>p==='view'||editable})};
 if(name==='./SupplierInvoices')return {invoicePermissions:{view:'view'}};
 if(name==='next/link')return {__esModule:true,default:({children,href})=>React.createElement('a',{href},children)};
 if(name==='@/app/components/ui')return {Button:({children,variant,...p})=>React.createElement('button',p,children),Alert:({children})=>React.createElement('div',{role:'alert'},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p))};
 return original.call(this,name,parent,main);
};
const Spot=require('../app/backoffice/contracts/SpotReconciliation.tsx').default;
const {useRefreshOnReturn}=require('../app/backoffice/contracts/useRefreshOnReturn.ts');
const root=createRoot(document.getElementById('root')),contract={id:'contract-test',start_date:'2026-08-01',end_date:'2026-08-31'};
const view={canConfigure:true,documents:[{id:'doc-test',original_filename:'private.pdf'}],rows:[],supplier:{contract:{id:contract.id},taxTreatment:'RESERVED',consumedMwh:'51.877714',billedMwh:'51.88',volumeDifferenceMwh:'-0.002286',reconciliationContext:{hash:'a'.repeat(64)},requirements:[{code:'SPOT_VOLUME_DIFFERENCE',message:'difference pending'},{code:'SPOT_TAX_RESERVATION',message:'tax pending'}]}};
const row={id:'review8',version:8,status:'APPROVED_TAX_RESERVATION',reason:'Reviewed with tax reservation',document_id:'doc-test',source_hash:'a'.repeat(64),created_by:'manager-test',created_at:'2026-10-02T12:00:00Z'};
async function resolve(value){await act(async()=>pending.shift().resolve(value));}
async function submit(){const f=document.querySelector('form');f.elements.status.value='APPROVED_TAX_RESERVATION';f.elements.documentId.value='doc-test';f.elements.reason.value=row.reason;f.elements.confirmed.checked=true;await act(async()=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
(async()=>{try{
 await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Spot,{contract,onDirty:()=>{}}))));assert.equal(calls.length,1,'cancelled StrictMode effect must not start a duplicate query');await resolve(view);
 assert.ok(document.querySelector('option[value=APPROVED_NO_COST]').disabled);assert.ok(!document.querySelector('option[value=APPROVED_TAX_RESERVATION]').disabled);
 await submit();assert.equal(calls.at(-1).options.body.sourceHash,row.source_hash);await resolve(row);assert.equal(calls.at(-1).options,undefined);assert.ok(document.body.textContent.includes('Atualizando os requisitos'));
 await resolve({...view,rows:[row],supplier:{...view.supplier,requirements:[],reconciliation:{current:true}}});assert.ok(!document.body.textContent.includes('difference pending'));assert.ok(!document.body.textContent.includes('tax pending'));assert.ok(document.body.textContent.includes('Requisitos atualizados'));
 await submit();await resolve({...row,id:'review9',version:9});await act(async()=>pending.shift().reject(Error('offline')));assert.ok(document.body.textContent.includes('versão 9 foi salva'));assert.ok(document.body.textContent.includes('não salve novamente'));assert.equal(calls.filter(c=>c.options).length,2);
 const nextContract={...contract,id:'contract-next'},lastContract={...contract,id:'contract-last'};
 await act(async()=>root.render(React.createElement(Spot,{contract:nextContract,onDirty:()=>{}})));
 await act(async()=>root.render(React.createElement(Spot,{contract:lastContract,onDirty:()=>{}})));
 await resolve({...view,rows:[{...row,reason:'STALE RESPONSE'}],supplier:{...view.supplier,contract:{id:nextContract.id}}});assert.ok(!document.body.textContent.includes('STALE RESPONSE'),'late response from old contract is ignored');
 await resolve({...view,rows:[{...row,reason:'CURRENT RESPONSE'}],supplier:{...view.supplier,contract:{id:lastContract.id}}});assert.ok(document.body.textContent.includes('CURRENT RESPONSE'));assert.ok(calls.at(-1).url.includes('contract-last'));
 await act(async()=>root.unmount());
 const root2=createRoot(document.getElementById('root'));let count=0,now=10000;const clock=Date.now;Date.now=()=>now;
 function Harness({enabled}){useRefreshOnReturn(enabled,()=>count++);return null;}
 await act(async()=>root2.render(React.createElement(Harness,{enabled:true})));assert.equal(count,0);
 await act(async()=>window.dispatchEvent(new Event('focus')));assert.equal(count,1);
 await act(async()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(count,1);
 await act(async()=>root2.render(React.createElement(Harness,{enabled:false})));now+=2000;await act(async()=>window.dispatchEvent(new Event('focus')));assert.equal(count,1);
 await act(async()=>root2.render(React.createElement(Harness,{enabled:true})));Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});await act(async()=>window.dispatchEvent(new Event('focus')));assert.equal(count,1);
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});await act(async()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(count,2);
 await act(async()=>root2.unmount());now+=2000;window.dispatchEvent(new Event('focus'));assert.equal(count,2);Date.now=clock;
 console.log('PASS reconciliation save/reload, partial success, tax guardrails, return refresh, duplicate events, busy/hidden guards, cancelled StrictMode query, stale contract response and cleanup');
}catch(e){console.error(e);process.exitCode=1;}finally{dom.window.close();}})();
