const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLFormElement','FormData','Event','MouseEvent'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
require.extensions['.css']=(m)=>m.exports={};
let context={scope:'organization',currentOrganization:{id:'o1'}},saved=null,failSave=true,delayFirst=null,queries=[];
const unit=(org='o1')=>({id:'u-'+org,organizationId:org,customerId:'c-'+org,customerName:org==='o1'?'<img src=x onerror=alert(1)> Cliente Um':'Cliente Dois',name:'Unidade '+org,number:'123',address:'Rua verificada',city:'Ribeirão Preto',state:'SP',distributor:'CPFL',market:'ACL',status:'ACTIVE',locationStatus:'PENDING',precision:null,latitude:null,longitude:null,addressHash:'a'.repeat(32),revision:0});
const result=org=>({organizationId:org,enabled:true,canManage:true,rows:[unit(org)],total:1,customers:1,confirmed:0,pending:1,stale:0,offset:0,limit:200});
let geojob=null,enabled=true,late=null,confirmations=0;
const apiRequest=async(url,o={})=>{
 assert.ok(url.startsWith('/api/v1/energy-map/units/'));
 if(late)return new Promise(resolve=>late.resolve=resolve);
 if(o.method==='POST')geojob={id:'job',status:'REVIEW',addressHash:'a'.repeat(32),revision:0,candidates:[{latitude:-21,longitude:-47,precision:'STREET',label:'<img src=x> Rua Um'}]};
 if(o.method==='PUT'){saved=o.body;confirmations++;if(failSave)throw Error('Falha segura');return {};}
 return {organizationId:'o1',unitId:'u-o1',enabled,job:geojob};
};
const original=Module._load;Module._load=function(name,parent,main){
 if(name==='@/app/lib/api/client')return {apiRequest};
 if(name==='@/app/providers')return {useAuth:()=>({context})};
 if(name==='@/app/components/ui')return {Button:({children,variant,...p})=>React.createElement('button',{type:'button',...p},children),Card:({children})=>React.createElement('section',null,children),Alert:({children})=>React.createElement('div',{role:'alert'},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p))};
 if(name==='@/app/components/ProtectedRoute'||name==='@/app/components/BackofficeShell')return {default:({children})=>children,__esModule:true};
 if(name==='next/dynamic')return {default:()=>()=>React.createElement('div',{'data-map':'true'},'Mapa em teste'),__esModule:true};
 return original.call(this,name,parent,main);
};
const Review=require('../app/backoffice/energy-map/GeocodingReview.tsx').default;
const root=createRoot(document.getElementById('root'));let checks=0,done=0;const check=v=>{assert.ok(v);checks++;};
const wait=async()=>act(async()=>{await new Promise(r=>setTimeout(r,20));});
const click=async(text)=>{let b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes(text));assert.ok(b,text);await act(async()=>b.click());};
(async()=>{try{
 await act(async()=>root.render(React.createElement(Review,{unit:unit(),onConfirmed:()=>done++})));await wait();check(document.body.textContent.includes('Buscar localização'));
 await click('Buscar localização');check(document.body.textContent.includes('Sugestões para conferência'));check(document.querySelector('img')===null);
 let confirm=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Confirmar'));check(confirm.disabled===true);
 await act(async()=>{const e=document.querySelector('fieldset input:not([type=radio]):not([type=checkbox])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Endereço conferido');e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[type=checkbox]').click();});
 await click('Confirmar');check(document.body.textContent.includes('Falha segura')&&done===0);const first=saved.requestId;
 failSave=false;await click('Confirmar');check(done===1&&saved.requestId===first&&saved.checkedAddress===true);
 late={};await act(async()=>root.render(React.createElement(Review,{key:'late',unit:unit(),onConfirmed:()=>done++})));await wait();check(typeof late.resolve==='function');
 await act(async()=>root.unmount());await act(async()=>late.resolve({organizationId:'o1',unitId:'u-o1',enabled:true,job:geojob}));check(!document.body.textContent.includes('Rua Um'));
 console.log(JSON.stringify({ok:true,checks}));
}catch(e){console.error(e);process.exitCode=1;}})();
