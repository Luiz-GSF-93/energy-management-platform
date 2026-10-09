const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,p);
require.extensions['.css']=m=>m.exports={};
let resolve,reject,calls=[];
const original=Module._load;Module._load=function(n,p,m){
 if(n==='@/app/lib/api/client')return {apiRequest:(...args)=>{calls.push(args);return new Promise((a,b)=>{resolve=a;reject=b;});}};
 if(n==='@/app/components/ui')return {Card:({children})=>React.createElement('section',null,children),Alert:({children})=>React.createElement('p',{role:'alert'},children),Button:({children,variant,...props})=>React.createElement('button',props,children)};
 if(n.startsWith('@/'))return original.call(this,require('path').resolve(__dirname,'../',n.slice(2)),p,m);
 return original.call(this,n,p,m);
};
const Dashboard=require('../app/components/PublishedForecastDashboard.tsx').default,root=createRoot(document.getElementById('root'));
const fixture={id:'test',unitName:'Test unit',version:2,publishedAt:'2026-09-01T12:00:00Z',asOfMonth:'2026-08',formulaVersion:'consumption-forecast/1.2',method:'MONTHLY_MEAN_DAILY',actual:[{month:'2026-08',consumptionKwh:'1000'}],future:[{month:'2026-09',predictedKwh:'1200',expansionKwh:'0',averageBasis:'SAME_MONTH'}],observedYearKwh:'1000',futureKwh:'1200',estimatedYearKwh:'2200',weatherStatus:'HISTORY_COLLECTED_NOT_APPLIED'};
(async()=>{
 await act(async()=>root.render(React.createElement(Dashboard)));
 assert.equal(calls[0][0],'/api/v1/portal/energy-forecasts');assert.equal(calls[0][1].cache,'no-store');
 await act(async()=>resolve({rows:[fixture]}));
 assert.ok(document.body.textContent.includes('Previsão validada e publicada'));assert.ok(document.body.textContent.includes('Média dos mesmos meses'));assert.ok(document.body.textContent.includes('ajuste climático não aplicado'));assert.ok(document.querySelector('svg rect'));
 await act(async()=>document.querySelector('button').click());assert.ok(!document.body.textContent.includes('1.200'));assert.ok(document.body.textContent.includes('Consultando'));
 await act(async()=>reject(Error('Vínculo indisponível')));assert.ok(document.querySelector('[role=alert]').textContent.includes('Vínculo'));assert.equal(document.querySelector('svg'),null);
 await act(async()=>document.querySelector('button').click());await act(async()=>resolve({rows:[]}));assert.ok(document.body.textContent.includes('Nenhuma previsão publicada'));assert.equal(document.querySelector('svg'),null);
 await act(async()=>root.unmount());assert.ok(calls.at(-1)[1].signal.aborted);
 console.log('13 client forecast checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
