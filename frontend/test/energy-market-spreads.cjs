/* Display only: all prices and spreads come from the backend. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>');
for(const k of ['window','document','HTMLElement','Event','MouseEvent'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
require.extensions['.css']=m=>{m.exports={};};
const Chart=require('../app/components/EnergyPriceChart.tsx').default;
const root=createRoot(document.getElementById('root'));
const month={month:'2026-01',acr:'600.00',acl:'300.00',pld:'180.12',pldSpread5:'189.13',pldSpread10:'198.14',pldSpread15:'207.14',scorePercent:'50.00'};
(async()=>{try{
 await act(async()=>root.render(React.createElement(Chart,{months:[month],footer:'Publicações conferidas.'})));
 assert.equal(document.querySelectorAll('path').length,6);
 assert.equal(document.querySelectorAll('path[stroke-dasharray]').length,3);
 assert.ok(document.body.textContent.includes('R$/MWh'));
 await act(async()=>document.querySelector('button').dispatchEvent(new MouseEvent('click',{bubbles:true})));
 for(const label of ['Perfil ACR','Perfil ACL','PLD + 5%','PLD + 10%','PLD + 15%','189,13','198,14','207,14'])assert.ok(document.body.textContent.includes(label),label);
 const oldApi={month:'2026-02',acr:null,acl:null,pld:null,scorePercent:null};
 await act(async()=>root.render(React.createElement(Chart,{months:[oldApi],footer:'Dados ausentes.'})));
 for(const el of document.querySelectorAll('path,circle'))assert.ok(!/NaN|Infinity/.test(el.outerHTML));
 assert.equal(document.querySelectorAll('circle').length,0);
 assert.ok(document.body.textContent.includes('Não disponível'));
 await act(async()=>root.unmount());
 console.log('Energy market: 16 display, missing-data and legacy-API checks passed');
}catch(e){console.error(e);process.exitCode=1;}})();
