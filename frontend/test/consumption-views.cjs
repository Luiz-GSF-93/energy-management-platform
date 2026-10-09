const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const key of ['window','document','HTMLElement','MouseEvent'])global[key]=dom.window[key];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
require.extensions['.tsx']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,p);
require.extensions['.css']=m=>{m.exports=new Proxy({},{get:(_,key)=>key==='__esModule'?false:String(key)});};const original=Module._load;
Module._load=function(name,...args){if(name==='@/app/components/ui')return {Card:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children)};return original.call(this,name,...args);};
const ConsumptionView=require('../app/backoffice/reports/ConsumptionViews.tsx').default;
// Synthetic data used only by this isolated regression test.
const invoices=[{month:'2026-01',consumptionKwh:'500.00',reservationCount:1,version:3,payloadHash:'a'.repeat(64)},{month:'2026-02',consumptionKwh:null,reservationCount:0}];const originalData=JSON.stringify(invoices),root=createRoot(document.getElementById('root'));let count=0;const check=value=>{assert.ok(value);count++;};
const sourceButton=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
(async()=>{try{
 await act(async()=>root.render(React.createElement(ConsumptionView,{invoices})));
 check(sourceButton('Visão distribuidora').getAttribute('aria-pressed')==='true');check(document.querySelector('[role=region]').textContent.includes('500'));check(document.querySelector('[role=region]').textContent.includes('não foi dividido'));check(document.querySelectorAll('.bar').length===1);
 const controlled=sourceButton('Visão CCEE').getAttribute('aria-controls');check(document.getElementById(controlled).getAttribute('role')==='region');
 await act(async()=>sourceButton('Visão CCEE').click());check(sourceButton('Visão CCEE').getAttribute('aria-pressed')==='true');check(sourceButton('Visão distribuidora').getAttribute('aria-pressed')==='false');check(!document.querySelector('[role=region]').textContent.includes('500'));check(document.querySelectorAll('.bar').length===0);check(document.querySelector('[role=region]').textContent.includes('Indisponível'));
 check(document.querySelector('details').textContent.includes('a'.repeat(64)));check(document.querySelector('details').textContent.includes('Versão 3'));check(document.querySelector('details table').rows[1].cells[3].textContent==='Indisponível');
 await act(async()=>sourceButton('Visão distribuidora').click());check(document.querySelectorAll('.bar').length===1);check(JSON.stringify(invoices)===originalData);
 await act(async()=>root.render(React.createElement(ConsumptionView,{invoices:[{...invoices[0],peakKwh:'100.00',offPeakKwh:'400.00'}]})));check(document.querySelectorAll('.peakBar.bar').length===1);check(document.querySelectorAll('.offPeakBar.bar').length===1);check(document.querySelector('[role=region]').textContent.includes('400'));
 await act(async()=>sourceButton('Visão CCEE').click());check(document.querySelectorAll('.bar').length===0);await act(async()=>sourceButton('Visão distribuidora').click());
 await act(async()=>root.render(React.createElement(ConsumptionView,{invoices:[]})));check(document.querySelectorAll('.bar').length===0);check(document.querySelector('[role=region]').textContent.includes('Nenhuma leitura'));
 await act(async()=>root.unmount());console.log(`${count} consumption source-view checks passed`);
 }catch(error){console.error(error);process.exitCode=1;}finally{dom.window.close();}})();
