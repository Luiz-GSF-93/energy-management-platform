/* Real review component with controlled API; no production mutations. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','HTMLTextAreaElement','HTMLDialogElement','Event','MouseEvent'])global[k]=dom.window[k];
HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let calls=[],pending=[];class ApiError extends Error{};const orig=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return {ApiError,apiRequest:(url,options)=>{calls.push({url,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};return orig.call(this,name,parent,main);};
const Component=require('../app/backoffice/documents/OcrIdentityReviews.tsx').default;
const field={key:'unit',label:'Unidade consumidora',unit:'',decimal:'1.574.348.035-70',state:'EXTRACTED_REVIEW',sourceHash:'a'.repeat(64),history:[],hasOlder:false};
const saved={id:'review-1',fieldKey:field.key,version:1,sourceHash:field.sourceHash,decision:'CONFIRMED',note:'Conferido no PDF',author:'Gestor teste',createdAt:'2026-09-27T12:00:00Z',value:field.decimal,unit:''};
const data={canReview:true,canImport:false,message:'Conferência humana',fields:[field]};
const root=createRoot(document.getElementById('root'));const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
async function click(t){await act(async()=>button(t).click());}async function result(d){await act(async()=>pending.shift().resolve(d));}async function choose(v){await act(async()=>{const s=document.querySelector('select');s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));});}
(async()=>{try{
 await act(async()=>root.render(React.createElement(Component,{id:'doc'})));
 await click('Carregar campos para conferência');await result(data);
 assert.ok(document.body.textContent.includes(field.decimal));assert.ok(button('Salvar conferência').disabled);
 await choose('CONFIRMED');await act(async()=>document.querySelector('input[type=checkbox]').click());assert.ok(button('Salvar conferência').disabled);
 await act(async()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Conferido no PDF');t.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.ok(!button('Salvar conferência').disabled);await click('Salvar conferência');assert.ok(calls.at(-1).url.endsWith('/identity-reviews'));assert.equal(calls.at(-1).options.body.checkedPdf,true);
 await result({canImport:false,review:saved});await result({...data,fields:[{...field,history:[saved]}]});
 assert.ok(document.body.textContent.includes('Conferência salva com sucesso'));assert.ok(document.body.textContent.includes('Gestor teste'));assert.ok(document.querySelector('input[type=checkbox]').disabled);assert.ok(document.querySelector('details').open);assert.ok(document.body.textContent.includes('Valor da época: '+field.decimal));
 await click('Atualizar histórico de identidade');await result({...data,fields:[{...field,sourceHash:'b'.repeat(64),state:'BLOCKED',history:[saved]}]});assert.ok(document.body.textContent.includes('cadastro mudou'));assert.ok(document.querySelector('option[value=CONFIRMED]').disabled);
 await click('Atualizar histórico de identidade');await result({...data,canReview:false});assert.equal(document.querySelector('fieldset'),null);assert.ok(document.body.textContent.includes('Somente Gestor'));
 await act(async()=>root.unmount());console.log('Identity review UI: save, required reason, receipt, history, verbatim UC, source change and permissions passed');
}catch(e){console.error(e);process.exitCode=1;}finally{dom.window.close();}})();
