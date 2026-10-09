const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const key of ['window','document','HTMLElement'])global[key]=dom.window[key];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,p);
const calls=[];const original=Module._load;Module._load=function(name,...args){if(name==='@/app/lib/api')return {apiRequest:(path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject}))};if(name==='./ReportPresentation')return {__esModule:true,default:({consumptionInvoices})=>React.createElement('pre',null,JSON.stringify(consumptionInvoices))};if(name==='@/app/components/ui')return {Alert:({children})=>React.createElement('p',null,children)};return original.call(this,name,...args);};
const Reader=require('../app/backoffice/reports/PublishedReportPresentation.tsx').default;
// Synthetic fixtures only; no test data imported by the application.
const invoice={groupId:'pub',month:'2026-01',version:2,payloadHash:'a'.repeat(64),consumptionKwh:'500.00',reservationCount:0};
const report=org=>({id:'report-'+org,body:{header:{organizationId:org,customerId:'customer-'+org,unitId:'unit-'+org},period:{from:'2026-01',to:'2026-01'},invoices:[invoice]}});
const response=org=>({organizationId:org,primary:{invoices:[{...invoice,unitId:'unit-'+org,measurements:{version:3,revision:2,validatedAt:'2026-02-01',source:'Fatura revisada '+org,measurements:{consumptionTotal:'500.00',consumptionPeak:'100.00',consumptionOffPeak:'400.00'}}}]}});
const root=createRoot(document.getElementById('root'));let count=0;const check=v=>{assert.ok(v);count++;};const render=(r,org)=>act(async()=>root.render(React.createElement(Reader,{report:r,organizationId:org,view:'OPERATIONAL'})));
(async()=>{try{
 await render(report('a'),'a');const first=calls[0],query=new URL(first.path,'https://test.invalid').searchParams;check(query.get('unitId')==='unit-a');check(query.get('customerId')==='customer-a');check(query.get('from')==='2026-01');check(!first.options.method);check(document.body.textContent.includes('Consultando'));
 await act(async()=>first.resolve(response('a')));check(document.body.textContent.includes('"peakKwh":"100.00"'));check(document.body.textContent.includes('Fatura revisada a'));
 await render(report('b'),'b');check(first.options.signal.aborted);check(!document.body.textContent.includes('Fatura revisada a'));const second=calls[1];
 await render(report('c'),'c');check(second.options.signal.aborted);await act(async()=>second.resolve(response('b')));check(!document.body.textContent.includes('Fatura revisada b'));const third=calls[2];
 await act(async()=>third.reject(new Error('provider unavailable')));check(document.body.textContent.includes('Consulta das medições indisponível'));check(document.body.textContent.includes('"consumptionKwh":"500.00"'));check(!document.body.textContent.includes('provider unavailable'));
 const prior=calls.length;await render(report('foreign'),'c');check(calls.length===prior);check(document.body.textContent.includes('Relatório indisponível na organização ativa'));check(!document.body.textContent.includes('500.00'));
 await act(async()=>root.unmount());console.log(`${count} consumption read-only/context checks passed`);
 }catch(error){console.error(error);process.exitCode=1;}finally{dom.window.close();}})();
