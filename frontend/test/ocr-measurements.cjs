/* Real component, isolated DOM, read-only API double. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','HTMLDialogElement','Event','MouseEvent'])global[k]=dom.window[k];
HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let pending=[],calls=[];const original=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return {apiRequest:(url,options)=>{assert.equal(options,undefined);calls.push(url);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};return original.call(this,name,parent,main);};
const Component=require('../app/backoffice/documents/OcrMeasurements.tsx').default;
const f={text:'123',decimal:'123',confidence:null,pages:[3],issues:['MISSING_CONFIDENCE']};
const h={source:'h1',reference:'2026-08',metric:'CONSUMPTION',period:'PEAK',unit:'kWh',decimal:'120.00',days:31,evidence:[f],issues:['HISTORY_FIELD_REVIEW_REQUIRED']};
const e={canImport:false,issues:[],meterReadings:[{source:'m1',kind:'ACTIVE_DEMAND',period:'OFF_PEAK',unit:'kW',fields:{quantityKind:{...f,text:'Demanda Ativa - kW'},meter:{...f,text:'<img src=x onerror=alert(1)>'},reading:f},issues:['METER_FIELD_REVIEW_REQUIRED']}],history:[h,{...h,source:'h2',period:'OFF_PEAK',decimal:'900.00'},{...h,source:'h3',metric:'DEMAND',decimal:'200.00'},{...h,source:'h4',metric:'DEMAND',decimal:'201.00'},{...h,source:'h5',reference:null,decimal:null}]};
const root=createRoot(document.getElementById('root'));
(async()=>{try{await act(async()=>root.render(React.createElement(Component,{evidence:e})));const text=document.body.textContent;
for(const s of ['Leituras dos medidores','Histórico de consumo e demanda','08/2026','120,00','900,00','31 dias faturados','Múltiplos valores — conferir','Competência a conferir','não informada para todos os campos','unidade','Fora ponta']){if(s!=='unidade')assert.ok(text.includes(s),s);}
assert.ok(!text.includes('200,00'));assert.ok(!text.includes('201,00'));assert.ok(!document.querySelector('img'));assert.ok(!text.includes('100%'));assert.equal(calls.length,0);await act(async()=>root.unmount());console.log('Measurements: 15 checks passed');}catch(e){console.error(e);process.exitCode=1;}finally{dom.window.close();}})();
