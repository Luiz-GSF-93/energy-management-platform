/* Synthetic invoice navigation; no OCR, AI, upload or production requests. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/portal/invoices',pretendToBeVisual:true});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLFormElement','Event','MouseEvent','FormData','File'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
let calls=0,mounts=0;const year=String(new Date().getFullYear()),month=year+'-01';
const row={id:'invoice',documentId:'document',unitId:'unit',unitName:'Unidade sintética',month,kind:'INVOICE',filename:'Fatura de teste.pdf',createdAt:'2026-01-01T12:00:00Z',status:{code:'RECEIVED',label:'Recebida'}};
const original=Module._load;Module._load=function(n,p,m){
 if(n.endsWith('.module.css'))return{};
 if(n==='./AutomaticInvoiceIntake')return{__esModule:true,default:()=>null};
 if(n==='./PortalInvoicePayment')return{__esModule:true,default:()=>React.createElement('span',null,'Pagamento informado')};
 if(n==='./PortalInvoiceViewer')return{__esModule:true,default:({filename})=>{React.useEffect(()=>{mounts++;},[]);return React.createElement('p',{'data-viewer':'true'},filename);}};
 if(n==='@/app/backoffice/documents/DocumentDialog')return{__esModule:true,default:({label,children})=>React.createElement('div',{role:'dialog','aria-label':label},children)};
 if(n==='@/app/lib/api/client')return{apiRequest:async(url,opt)=>{if(url.endsWith('/context'))return{units:[{id:'unit',name:'Unidade sintética'}]};assert.ok(url.endsWith('/invoices/library'));assert.equal(opt.method,'POST');calls++;return{year:opt.body.year,rows:[row],conflicts:0};}};
 if(n.startsWith('@/'))return original.call(this,path.resolve(__dirname,'..',n.slice(2)),p,m);
 return original.call(this,n,p,m);
};
const oldInterval=global.setInterval,oldClear=global.clearInterval,timers=new Map();let seq=0;global.setInterval=(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;};global.clearInterval=id=>timers.delete(id);
const Invoices=require('../app/components/PortalInvoices.tsx').default,root=createRoot(document.getElementById('root'));
const click=async text=>act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click());
const tick=async()=>act(async()=>{for(const {fn,ms}of timers.values())if(ms===30000)fn();});
(async()=>{try{
 await act(async()=>root.render(React.createElement(Invoices)));assert.equal(calls,1);
 await act(async()=>document.querySelector('[aria-label^="Janeiro de"]').click());const initial=calls;await tick();assert.equal(calls,initial,'month being read is not replaced by a background library update');
 await click('Visualizar fatura');const viewer=document.querySelector('[data-viewer]');assert.ok(viewer);assert.equal(mounts,1);await tick();await tick();assert.equal(calls,initial);assert.equal(document.querySelector('[data-viewer]'),viewer);assert.equal(mounts,1,'PDF viewer is not remounted by the periodic timer');
 await click('Voltar às faturas do mês');await tick();assert.equal(calls,initial,'return to the same month keeps the reading paused');
 await click('Fechar mês');await tick();assert.equal(calls,initial+1,'automatic library checks resume after the document/month is closed');assert.equal(document.querySelectorAll('[aria-label*="faturas"]').length,12);
 console.log('Invoice reading: month, PDF, viewer identity and resumption after close passed');
}finally{await act(async()=>root.unmount());global.setInterval=oldInterval;global.clearInterval=oldClear;dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
