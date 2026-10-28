const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const React=require('react'),{JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});
for(const k of ['window','document','navigator','HTMLElement','Event','CustomEvent','MouseEvent'])Object.defineProperty(global,k,{value:dom.window[k],configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const context={scope:'organization',user:{id:'actor',email:'synthetic@example.test'},currentOrganization:{id:'org'}};
let componentApi=null;const requests=[],original=Module._load;
Module._load=function(n,p,m){
 if(n==='@/app/providers')return {useAuth:()=>({context})};
 if(n==='@/app/lib/auth/renew')return {freshToken:async()=> 'token',sessionAttention:()=>{}};
 if(n==='@/app/components/ui'||n==='./ui')return {Alert:({children})=>React.createElement('aside',null,children),Button:({children,variant,...props})=>React.createElement('button',props,children),Card:({children})=>React.createElement('section',null,children)};
 if(n==='@/app/lib/api/client'&&componentApi)return {apiRequest:(...args)=>componentApi(...args)};
 if(n.startsWith('@/'))return original.call(this,path.resolve(__dirname,'../',n.slice(2)),m);
 return original.call(this,n,p,m);
};
const {session}=require('../app/lib/auth/session.ts'),{selectPortalCustomer,portalSelection}=require('../app/lib/auth/portal-customer.ts');
const jwt='e30.'+Buffer.from(JSON.stringify({sub:'actor',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
session.setTokens({access_token:jwt,refresh_token:'synthetic'});process.env.NEXT_PUBLIC_API_URL='https://api.example.test';
const {apiRequest}=require('../app/lib/api/client.ts'),select=id=>selectPortalCustomer({organizationId:'org',userId:'actor',customerId:id});
const {createRoot}=require('react-dom/client'),{act}=React;
(async()=>{try{
 select('a');let sent;global.fetch=async(url,opts)=>{sent=opts.headers;return {ok:true,status:200,json:async()=>({ok:true})};};
 await apiRequest('/api/v1/portal/financial');assert.equal(sent.get('x-portal-customer'),'a');
 await apiRequest('/api/v1/portal/customers');assert.equal(sent.get('x-portal-customer'),null,'choice discovery never trusts a stale selection');
 let release;global.fetch=async()=>new Promise(r=>release=r);const stale=apiRequest('/api/v1/portal/invoices');await new Promise(r=>setImmediate(r));select('b');release({ok:true,status:200,json:async()=>({otherCustomer:'a'})});await assert.rejects(stale,e=>e.status===409);
 let denied=0;window.addEventListener('portal-scope-denied',()=>denied++);global.fetch=async()=>({ok:false,status:403,json:async()=>({message:'revoked'})});await assert.rejects(apiRequest('/api/v1/portal/financial'));assert.equal(denied,1);
 const data={enabled:true,organizationId:'org',customerId:'a',customers:[{id:'a',name:'Company A'},{id:'b',name:'Company B'}]};
 componentApi=async()=>data;const Boundary=require('../app/components/PortalCustomerBoundary.tsx').default;let mounts=0,unmounts=0;
 function Child(){React.useEffect(()=>{mounts++;return()=>unmounts++;},[]);return React.createElement('p',null,'Authorized content');}
 const root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(Boundary,null,React.createElement(Child))));
 assert.equal(portalSelection().customerId,'b');const picker=document.querySelector('select');await act(async()=>{picker.value='a';picker.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(portalSelection().customerId,'a');assert.equal(mounts,2);assert.equal(unmounts,1,'switching company must remove old charts/PDF state');
 componentApi=async()=>{throw Error('Access revoked');};await act(async()=>window.dispatchEvent(new Event('portal-scope-denied')));assert(!document.body.textContent.includes('Authorized content'));assert(document.body.textContent.includes('Access revoked'));await act(async()=>root.unmount());
 componentApi=async(url,options)=>{if(options?.method==='POST'){requests.push(options.body);return {enabled:true};}return {enabled:true,organizationId:'org',members:[{id:'actor',name:'Reader'}],customers:[{id:'a',name:'Company A'}],units:[{id:'a1',customerId:'a',name:'A1',number:'101'},{id:'a2',customerId:'a',name:'A2',number:'102'}],grants:[],history:[]};};
 const Access=require('../app/backoffice/users/PortalCustomerAccess.tsx').default,root2=createRoot(document.getElementById('root'));await act(async()=>root2.render(React.createElement(Access)));
 for(const [label,value] of [['Usuário externo do Portal','actor'],['Cliente autorizado no Portal','a']])await act(async()=>{const el=document.querySelector('[aria-label="'+label+'"]');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>document.querySelector('fieldset input').click());const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set;
 await act(async()=>{const el=document.querySelector('textarea');setter.call(el,'Synthetic authorized unit selection');el.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(requests.length,1);assert.deepEqual(requests[0].unitIds,['a1']);assert.equal(requests[0].customerId,'a');assert.equal(requests[0].active,true);assert(requests[0].requestId);await act(async()=>root2.unmount());
 console.log('Portal access UI/API: scoped headers, stale-response discard, revocation, company remount and explicit unit save passed');
}finally{Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
