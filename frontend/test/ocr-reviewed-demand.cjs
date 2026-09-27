/* Real review component with controlled API; no production mutations. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','HTMLTextAreaElement','HTMLDialogElement','Event','MouseEvent'])global[k]=dom.window[k];
HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let calls=[],pending=[];class ApiError extends Error{};const orig=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return {ApiError,apiRequest:(url,options)=>{calls.push({url,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};return orig.call(this,name,parent,main);};
const Component=require('../app/backoffice/documents/OcrReviewedDemand.tsx').default;
const root=createRoot(document.getElementById('root'));const button=()=>document.querySelector('button');
const full={canImport:false,state:'COMPLETE',usedKw:'234.6400',unusedKw:'265.3600',reviewed:2,total:2,message:'Não aprova cálculo',rows:[{key:'one',label:'Parcela 1',state:'USED',decimal:'234.6400',review:{id:'one',author:'Gestor <img>',version:2,createdAt:'2026-09-27'}}]};
async function render(id,revision){await act(async()=>root.render(React.createElement(Component,{documentId:id,revision})));}
async function resolve(summary){await act(async()=>pending.shift().resolve({summary}));}
(async()=>{try{
 await render('a',0);assert.equal(calls.length,0);
 await render('a',1);assert.equal(calls[0].url,'/api/v1/documents/a/ocr/demand-reviews');await resolve(full);assert.ok(document.body.textContent.includes('234,6400 kW'));assert.ok(document.body.textContent.includes('265,3600 kW'));assert.ok(document.body.textContent.includes('Gestor <img>'));assert.equal(document.querySelector('img'),null);
 await act(async()=>button().click());assert.ok(!document.body.textContent.includes('234,6400'));await act(async()=>pending.shift().reject(new Error('network')));assert.ok(document.querySelector('[role=alert]'));assert.ok(!document.body.textContent.includes('265,3600'));
 await render('a',2);await render('b',1);await resolve(full);assert.ok(!document.body.textContent.includes('234,6400'));await resolve({...full,state:'PENDING',usedKw:null,unusedKw:null,reviewed:0,rows:[]});assert.ok(document.body.textContent.includes('Pendente'));assert.ok(!document.body.textContent.includes('265,3600'));assert.ok(calls.every(c=>!c.options));
 await render('b',2);await act(async()=>root.unmount());await resolve(full);console.log('Reviewed demand: completion, pending, failure, refresh, document isolation, stale responses, safe text and read-only access passed');
 }catch(e){console.error(e);process.exitCode=1;}finally{dom.window.close();}})();