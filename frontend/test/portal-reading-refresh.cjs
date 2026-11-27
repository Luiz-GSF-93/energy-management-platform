/* Reading continuity with synthetic data only; no network or customer records. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid',pretendToBeVisual:true});
for(const k of ['window','document','HTMLElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const {useReadingRefresh,isTemporaryReadingFailure}=require('../app/components/useReadingRefresh.ts');
let checks=0,control;const ok=(v,m)=>{assert.ok(v,m);checks++;};
function Harness({scope='first',defer=true}){const [data,setData]=React.useState(null);const reading=useReadingRefresh({scope,defer,data,apply:setData});control={...reading,data,clearData:()=>{reading.clear();setData(null);}};return React.createElement('section',null,React.createElement('input',{defaultValue:'Filtro do usuário'}),React.createElement('details',null,React.createElement('summary',null,'Detalhes'),React.createElement('p',null,'Texto em leitura')),React.createElement('output',null,data?.value??'Sem consulta'),React.createElement('button',{disabled:!reading.pending,onClick:reading.accept},'Aplicar'));}
const root=createRoot(document.getElementById('root'));
(async()=>{try{
 for(const status of [408,429,500,502,503,504,599])ok(isTemporaryReadingFailure({status}),'temporary HTTP may retain reading');
 for(const status of [0,400,401,403,404,409,422])ok(!isTemporaryReadingFailure({status}),'authorization and validation never retain a stale scope');
 ok(isTemporaryReadingFailure(new TypeError('Failed to fetch')),'network fetch failure is temporary');ok(!isTemporaryReadingFailure(new TypeError('Cannot read properties of undefined')),'malformed content is not mistaken for a network failure');ok(!isTemporaryReadingFailure(new Error('Acesso revogado')),'unknown errors fail closed');
 await act(async()=>root.render(React.createElement(Harness)));
 await act(async()=>control.offer({value:'Versão 1',updatedAt:'first'}));ok(control.data.value==='Versão 1','first authorized data renders immediately');
 const input=document.querySelector('input'),details=document.querySelector('details'),output=document.querySelector('output');input.value='Período escolhido';details.open=true;input.focus();
 await act(async()=>control.offer({value:'Versão 1',updatedAt:'query-time-only'}));ok(!control.pending,'query time alone does not create a new publication');
 await act(async()=>control.offer({value:'Versão 2',updatedAt:'second'}));ok(control.pending&&output.textContent==='Versão 1','new data waits for explicit application');ok(document.activeElement===input&&input.value==='Período escolhido'&&details.open,'focus, draft filter and open details remain');
 await act(async()=>document.querySelector('button').click());ok(output===document.querySelector('output')&&output.textContent==='Versão 2','apply updates existing DOM without remounting');ok(input.value==='Período escolhido'&&details.open,'intentional update preserves local state');
 await act(async()=>{control.expectRefresh();control.offer({value:'Consulta manual'});});ok(!control.pending&&output.textContent==='Consulta manual','explicit refresh may apply successful response immediately');
 await act(async()=>control.offer({value:'Pending old customer'}));ok(control.pending,'old scope has a pending publication');
 await act(async()=>root.render(React.createElement(Harness,{scope:'new customer'})));ok(!control.pending,'scope change discards pending private data');
 await act(async()=>control.offer({value:'New customer'}));ok(output.textContent==='New customer'&&!control.pending,'first result of new scope is not held behind old reading');
 await act(async()=>{control.offer({value:'Pending'});});await act(async()=>control.clearData());ok(!control.pending&&output.textContent==='Sem consulta','access denial clears visible and pending snapshots');
 await act(async()=>root.render(React.createElement(Harness,{scope:'backoffice',defer:false})));await act(async()=>control.offer({value:'Backoffice 1'}));await act(async()=>control.offer({value:'Backoffice 2'}));ok(output.textContent==='Backoffice 2'&&!control.pending,'backoffice automatic behavior remains available');
 console.log(checks+' portal reading continuity and access-boundary checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
