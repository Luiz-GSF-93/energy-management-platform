/* Silent refresh: preserve DOM/focus/series while authenticated data refreshes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),path=require('node:path');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid',pretendToBeVisual:true});for(const k of ['window','document','HTMLElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
let api;const original=Module._load;Module._load=function(n,p,m){if(n.endsWith('.css'))return {};if(n==='@/app/lib/api/client')return {apiRequest:(...args)=>api(...args)};if(n==='@/app/components/ui')return {Alert:({children})=>React.createElement('div',{role:'alert'},children),Button:({variant,...props})=>React.createElement('button',props)};return original.call(this,n,p,m);};
const Dashboard=require('../app/components/EnergyPriceDashboard.tsx').default,root=createRoot(document.getElementById('root'));const year=new Date().getFullYear(),month=year+'-01';
const response={organizationId:'org',audience:'client',customerId:'client',year,units:[],baselines:[],months:[{month,acr:'200.00',acl:'100.00',pld:'80.00',scorePercent:null}],acrAverage:'200.00',aclAverage:'100.00',indicative:{value:null,reason:'Conferir'},footer:'Fontes publicadas',disclosure:'Conferir'};
let now=10000,calls=0;const realNow=Date.now,realInterval=global.setInterval,realClear=global.clearInterval;Date.now=()=>now;
const timers=new Map();let timerId=0;global.setInterval=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;};global.clearInterval=id=>timers.delete(id);
const signal=async()=>act(async()=>{now+=2000;window.dispatchEvent(new Event('portal-updated'));});
const tick=async()=>act(async()=>{now+=60000;for(const {fn} of timers.values())fn();});
(async()=>{try{
 api=async()=>{calls++;return response;};await act(async()=>root.render(React.createElement(Dashboard,{organizationId:'org',audience:'client'})));
 assert.equal(timers.size,1,'one periodic authenticated refresh, not two competing timers');
 const box=document.querySelector('input[type=checkbox]');await act(async()=>box.click());const monthButton=document.querySelector('[aria-label="Valores de '+month+'"]');await act(async()=>monthButton.click());box.focus();const svg=document.querySelector('svg');
 const pending=[];api=(url,options)=>{calls++;return new Promise(resolve=>pending.push({resolve,options}));};
 await signal();assert.equal(pending.length,1);assert.equal(document.querySelector('svg'),svg);assert.equal(document.activeElement,box);
 const before=calls;await tick();await signal();await signal();assert.equal(calls,before,'polls and publication events coalesce while request is in flight');assert.equal(pending[0].options.signal.aborted,false,'slow response is not aborted by the next minute');
 await act(async()=>pending[0].resolve({...response,aclAverage:'101.00'}));assert.equal(pending.length,2,'one follow-up checks publications received during the request');
 await act(async()=>pending[1].resolve({...response,months:[{...response.months[0],pld:'84.79'}]}));
 assert.equal(document.querySelector('svg'),svg);assert.equal(document.activeElement,box);assert.equal(box.checked,false);assert.equal(monthButton.getAttribute('aria-pressed'),'true');assert.ok(document.body.textContent.includes('84,79'));assert.ok(document.body.textContent.includes('Última consulta:'));
 let hidden=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});const hiddenCalls=calls;await tick();assert.equal(calls,hiddenCalls,'hidden page does not poll');hidden=false;await signal();await tick();hidden=true;const beforeHiddenCompletion=calls;await act(async()=>pending[2].resolve(response));assert.equal(calls,beforeHiddenCompletion,'queued recheck waits when the slow response finishes in a hidden tab');
 api=async()=>{calls++;return {...response,months:[{...response.months[0],pld:'90.00'}]};};hidden=false;await act(async()=>{now+=2000;document.dispatchEvent(new Event('visibilitychange'));});assert.ok(document.body.textContent.includes('90,00'),'returning to page reloads current published values');
 api=async()=>{throw Error('Acesso revogado');};await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar').click());assert.equal(document.querySelector('svg'),null);assert.ok(document.body.textContent.includes('Acesso revogado'));
 console.log('Price refresh: one timer, slow requests, coalesced publication events, fresh PLD, focus/month/series, visibility and revoked access passed');
 }finally{await act(async()=>root.unmount());global.setInterval=realInterval;global.clearInterval=realClear;Date.now=realNow;dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
