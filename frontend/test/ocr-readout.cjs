/* Real component, isolated DOM, read-only API double. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','HTMLDialogElement','Event','MouseEvent'])global[k]=dom.window[k];
HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let pending=[],calls=[];const original=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return {apiRequest:(url,options)=>{assert.equal(options,undefined);calls.push(url);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};return original.call(this,name,parent,main);};
const Component=require('../app/backoffice/documents/OcrReadout.tsx').default;
const stats={total:6,known:1,missing:5,low:0,review:0,high:1,minimum:.99,mean:.99};const summary={pages:[1,2],fieldConfidence:stats,criticalConfidence:{...stats,complete:false,minimumAll:null,matched:0},fieldsTruncated:false};
const root=createRoot(document.getElementById('root'));let checks=0;const ok=v=>{assert.ok(v);checks++;};
async function click(text){const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);assert.ok(b,text);await act(async()=>b.click());}
async function page(n){await act(async()=>{const el=document.querySelector('select');el.value=String(n);el.dispatchEvent(new Event('change',{bubbles:true}));});}
const result=(text,page=1)=>({page,section:'fields',total:1,offset:0,nextOffset:null,previousOffset:null,truncated:false,text:'',rows:[{id:'one',label:'documents[0].InvoiceTotal',text,confidence:.85,pages:[page],sourceVerified:true}]});
(async()=>{try{
 await act(async()=>root.render(React.createElement(Component,{id:'doc',summary})));
 ok(document.body.textContent.includes('indeterminada — há campos sem confiança'));ok(document.body.textContent.includes('Aprovação automática: não'));
 await click('Ver informações técnicas da fatura');ok(document.querySelector('dialog').open);ok(calls[0].includes('/doc/ocr/readout?page=1&section=fields'));
 await page(2);await act(async()=>pending[1].resolve(result('Energia página 2',2)));await act(async()=>pending[0].resolve(result('Resposta antiga')));
 ok(document.body.textContent.includes('Energia página 2'));ok(!document.body.textContent.includes('Resposta antiga'));ok(document.body.textContent.includes('Revisão necessária'));
 await page(1);await act(async()=>pending[2].reject(Error('private backend error')));ok(document.body.textContent.includes('Tente novamente'));ok(!document.body.textContent.includes('private backend error'));
 await click('Tentar novamente');await act(async()=>pending[3].resolve(result('<img src=x onerror=alert(1)>')));ok(!document.querySelector('img'));ok(document.body.textContent.includes('<img src=x'));
 await page(2);await click('Fechar');await act(async()=>pending[4].resolve(result('Resposta após fechamento')));ok(!document.querySelector('dialog').open);ok(!document.body.textContent.includes('Resposta após fechamento'));
 await act(async()=>root.unmount());console.log('OCR technical readout: '+checks+' checks passed');
 }catch(e){console.error(e);process.exitCode=1;}finally{dom.window.close();}})();
