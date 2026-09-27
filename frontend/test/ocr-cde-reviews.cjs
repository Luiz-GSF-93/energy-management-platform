/* Real review component with controlled API; no production mutations. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','HTMLTextAreaElement','HTMLDialogElement','Event','MouseEvent'])global[k]=dom.window[k];
HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let calls=[],pending=[];class ApiError extends Error{};const orig=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return {ApiError,apiRequest:(url,options)=>{calls.push({url,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};return orig.call(this,name,parent,main);};
const Component=require('../app/backoffice/documents/OcrCdeReviews.tsx').default;
const field={key:'consumptionPeakKwh',label:'Consumo ponta',state:'EXTRACTED_DESCRIPTION',description:{text:'CDE Escassez Hídrica Ponta AGO/26'},source:'tables[0].rows[2]',sourceHash:'a'.repeat(64),history:[],hasOlder:false};
const saved={id:'review-1',fieldKey:field.key,version:1,sourceHash:field.sourceHash,decision:'CONFIRMED',note:'<img src=x>',author:'Operador de teste',createdAt:'2026-09-26T12:00:00Z',value:field.description.text,unit:''};
const data={canReview:true,canImport:false,message:'Conferência não é aprovação financeira.',fields:[field]};
const root=createRoot(document.getElementById('root'));const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
async function click(t){await act(async()=>button(t).click());}async function result(d){await act(async()=>pending.shift().resolve(d));}async function choose(v){await act(async()=>{const s=document.querySelector('select');s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));});}
(async()=>{try{
 await act(async()=>root.render(React.createElement(Component,{id:'doc-a',onSaved:()=>{}})));assert.equal(calls.length,0);
 await click('Conferir descrição CDE no PDF');assert.equal(calls.length,1);assert.equal(calls[0].options,undefined);await result(data);
 assert.ok(document.querySelector('dialog').open);assert.ok(button('Salvar conferência').disabled);assert.ok(document.body.textContent.includes('CDE Escassez Hídrica Ponta AGO/26'));
 await choose('CONFIRMED');assert.ok(button('Salvar conferência').disabled);await act(async()=>document.querySelector('input[type=checkbox]').click());assert.ok(button('Salvar conferência').disabled);await act(async()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Conferido no PDF página 1');t.dispatchEvent(new Event('input',{bubbles:true}));});assert.ok(!button('Salvar conferência').disabled);
 await click('Salvar conferência');const first=calls.at(-1);assert.equal(first.options.method,'POST');assert.equal(first.options.body.checkedPdf,true);assert.equal(first.options.body.expectedReviewId,null);assert.ok(first.options.body.requestId);assert.ok(button('Salvando…').disabled);
 await act(async()=>pending.shift().reject(new Error('network')));assert.ok(document.querySelector('[role=alert]'));await click('Salvar conferência');assert.equal(calls.at(-1).options.body.requestId,first.options.body.requestId);
 await result({canImport:false,review:saved});assert.equal(calls.at(-1).options,undefined);
 assert.ok(document.body.textContent.includes('Conferência salva com sucesso'));assert.ok(document.body.textContent.includes('Operador de teste'));assert.ok(document.querySelector('input[type=checkbox]').disabled);assert.ok(document.querySelector('input[type=checkbox]').checked);assert.equal(button('Salvar conferência'),undefined);assert.ok(document.querySelector('details').open);
 // A refresh failure must not erase the authoritative POST receipt or reopen the form.
 await act(async()=>pending.shift().reject(new Error('history offline')));assert.ok(document.body.textContent.includes('o registro foi salvo'));assert.ok(document.body.textContent.includes('Conferência salva com sucesso'));assert.ok(document.body.textContent.includes('Operador de teste'));assert.equal(document.querySelector('img'),null);
 await click('Atualizar histórico CDE');await result({...data,fields:[{...field,history:[saved]}]});assert.ok(document.body.textContent.includes('Conferência salva com sucesso'));assert.ok(document.querySelector('input[type=checkbox]').disabled);
 await click('Registrar nova revisão');
 await choose('NEEDS_CORRECTION');assert.ok(button('Salvar conferência').disabled);await choose('CONFIRMED');assert.ok(button('Salvar conferência').disabled);
 await click('Atualizar histórico CDE');await result({...data,canReview:false,fields:[{...field,history:[saved]}]});assert.equal(document.querySelector('fieldset'),null);assert.ok(document.body.textContent.includes('Operador de teste'));assert.equal(calls.filter(c=>c.options?.method==='POST').length,2);
 await click('Fechar conferência CDE');assert.ok(!document.querySelector('dialog').open);
 await act(async()=>root.render(React.createElement(Component,{id:'doc-a',onSaved:()=>{}})));await click('Conferir descrição CDE no PDF');await result({...data,fields:[{...field,history:[saved]}]});assert.ok(document.querySelector('input[type=checkbox]').disabled);assert.ok(document.querySelector('details').open);
 await click('Atualizar histórico CDE');await result({...data,fields:[{...field,sourceHash:'b'.repeat(64),history:[saved]}]});assert.ok(document.body.textContent.includes('A leitura mudou'));assert.equal(button('Registrar nova revisão'),undefined);assert.ok(button('Salvar conferência').disabled);assert.ok(!document.body.textContent.includes('Conferência salva com sucesso'));
 await click('Fechar conferência CDE');await act(async()=>root.unmount());console.log('Demand review: permission, PDF, evidence, replay, history and safe text checks passed');
}catch(e){console.error(e);process.exitCode=1;}finally{dom.window.close();}})();
