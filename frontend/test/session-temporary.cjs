const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const React=require('react'),{JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});
for(const k of ['window','document','navigator','HTMLElement','Event','CustomEvent','MouseEvent'])Object.defineProperty(global,k,{value:dom.window[k],configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
let now=100000,ended=0,renewalError=null,renewals=0;const intervals=new Map();let seq=0;const realNow=Date.now;Date.now=()=>now;
window.setInterval=(fn,ms)=>{intervals.set(++seq,{fn,ms});return seq;};window.clearInterval=id=>intervals.delete(id);
const original=Module._load;Module._load=function(n,p,m){
 if(n==='@/app/lib/auth/session')return {session:{getAccessToken:()=> 'token'},tokenClaims:()=>({sub:'actor'}),endSession:()=>ended++};
 if(n==='@/app/lib/auth/renew')return {freshToken:async()=>{renewals++;if(renewalError)throw renewalError;return 'token';}};
 if(n==='@/app/lib/api/client')return {apiRequest:async()=>{throw Error('Unexpected request');}};
 return original.call(this,n,p,m);
};
const Component=require('../app/components/SessionNotice.tsx').default,{createRoot}=require('react-dom/client'),{act}=React,root=createRoot(document.getElementById('root'));
const context={scope:'organization',user:{id:'actor',email:'synthetic@example.test'},currentOrganization:{id:'org'}};
const attention=(kind,message)=>window.dispatchEvent(new CustomEvent('session-attention',{detail:{kind,message}}));
const tick=async()=>act(async()=>{for(const t of [...intervals.values()])if(t.ms===250)t.fn();});
(async()=>{try{
 await act(async()=>root.render(React.createElement(Component,{context})));
 await act(async()=>attention('connection','Conexão indisponível'));now+=20000;await tick();assert.equal(ended,0,'network errors cannot expire a valid session');
 await act(async()=>attention('expired','Acesso expirou'));assert(document.body.textContent.includes('10 segundos'));
 now+=9000;await tick();assert.equal(ended,0);await act(async()=>attention('expired','Acesso expirou novamente'));
 now+=1001;await tick();assert.equal(ended,1,'repeated notices cannot extend the deadline');
 await act(async()=>root.render(React.createElement(Component,{key:'renew',context})));
 await act(async()=>attention('expired','Acesso expirou'));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Renovar acesso').click());
 now+=20000;await tick();assert.equal(ended,1,'successful renewal cancels expiry');assert(!document.querySelector('aside'));
 await act(async()=>attention('expired','Acesso expirou'));await act(async()=>root.unmount());now+=20000;await tick();assert.equal(ended,1,'unmounted notices cannot end a different session');
 console.log('Temporary session: network isolation, 10-second deadline, repeated notices, renewal cancellation and cleanup passed');
 }finally{Date.now=realNow;Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
