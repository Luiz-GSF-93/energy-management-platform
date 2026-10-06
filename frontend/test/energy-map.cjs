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
const apiRequest=async(url,o={})=>{
 if(url.startsWith('/api/v1/admin/energy-map?')){queries.push(url);return {scope:'global',rows:[{...unit(),organizationName:'Organização Um',hasUnit:true},{...unit('o2'),organizationName:'Organização Dois',hasUnit:true},{...unit('o2'),id:'customer:empty',customerId:'empty',customerName:'Cliente Sem Unidade',organizationName:'Organização Dois',hasUnit:false,locationStatus:'NO_UNIT'}],total:3,customers:3,organizations:2,units:2,withoutUnits:1,confirmed:0,pending:2,organizationOptions:[{id:'o1',name:'Organização Um'},{id:'o2',name:'Organização Dois'}]};}
 assert.ok(url.startsWith('/api/v1/energy-map/'),'map requests use the deployed API prefix');
 const org=context.currentOrganization.id;
 if(url.endsWith('/access'))return {organizationId:org,enabled:true};
 if(url.includes('/history'))return [];
 if(o.method==='PUT'){saved=o.body;if(failSave)throw Error('Falha simulada; dados preservados');return {};}
 queries.push(url);if(delayFirst&&org==='o1')return new Promise(resolve=>delayFirst.resolve=resolve);
 return result(org);
};
const original=Module._load;Module._load=function(name,parent,main){
 if(name==='@/app/lib/api/client')return {apiRequest};
 if(name==='@/app/providers')return {useAuth:()=>({context})};
 if(name==='@/app/components/ui')return {Button:({children,variant,...p})=>React.createElement('button',{type:'button',...p},children),Card:({children})=>React.createElement('section',null,children),Alert:({children})=>React.createElement('div',{role:'alert'},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p))};
 if(name==='@/app/components/ProtectedRoute'||name==='@/app/components/BackofficeShell')return {default:({children})=>children,__esModule:true};
 if(name==='next/dynamic')return {default:()=>()=>React.createElement('div',{'data-map':'true'},'Mapa em teste'),__esModule:true};
 return original.call(this,name,parent,main);
};
const Page=require('../app/backoffice/energy-map/page.tsx').default;
const {mapGeoJson}=require('../app/backoffice/energy-map/map-data.ts');
const root=createRoot(document.getElementById('root'));let checks=0;const check=v=>{assert.ok(v);checks++;};
const wait=async()=>act(async()=>{await new Promise(r=>setTimeout(r,350));});
const click=async(t)=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes(t));assert.ok(b,t);await act(async()=>b.click());};
const fill=async(name,v)=>{const e=document.querySelector('[name="'+name+'"]');assert.ok(e,name);await act(async()=>{Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));});};
(async()=>{try{
 check(mapGeoJson([{...unit(),latitude:-21,longitude:-47,locationStatus:'CONFIRMED',precision:'ADDRESS'}, {...unit('o2'),latitude:-22,longitude:-48,locationStatus:'CONFIRMED'}, {...unit(),latitude:-21,longitude:-47,locationStatus:'STALE'}],'o1').features.length===1);
 check(mapGeoJson([{...unit(),latitude:-21,longitude:-47,locationStatus:'CONFIRMED'}],'o1').features[0].geometry.coordinates.join(',')==='-47,-21');
 await act(async()=>root.render(React.createElement(Page)));await wait();
 check(document.body.textContent.includes('Cliente Um'));check(document.querySelector('img')===null);
 await click('Ver unidade');await click('Localizar unidade');
 await fill('latitude','-21.18');await fill('longitude','-47.81');await fill('reason','Planta cadastral conferida');
 await act(async()=>document.querySelector('[name=checkedAddress]').click());
 await act(async()=>document.querySelector('dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 check(document.body.textContent.includes('Falha simulada'));check(document.querySelector('[name=latitude]').value==='-21.18');
 const request=saved.requestId;check(saved.addressHash==='a'.repeat(32)&&saved.revision===0&&saved.checkedAddress===true);
 failSave=false;await act(async()=>document.querySelector('dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));check(saved.requestId===request);await wait();
 check(!document.querySelector('dialog').hasAttribute('open'));
 // A late response from the previous organization cannot populate the new view.
 delayFirst={resolve:null};await click('Atualizar');await wait();check(typeof delayFirst.resolve==='function');
 context={scope:'organization',currentOrganization:{id:'o2'}};await act(async()=>root.render(React.createElement(Page)));await wait();
 check(document.body.textContent.includes('Cliente Dois')&&!document.body.textContent.includes('Cliente Um'));
 await act(async()=>delayFirst.resolve(result('o1')));check(!document.body.textContent.includes('Cliente Um'));
 // No detailed portfolio in global context.
 context={scope:'global'};await act(async()=>root.render(React.createElement(Page)));check(!document.body.textContent.includes('Cliente Dois')&&document.body.textContent.includes('Selecione uma organização'));
 context={scope:'global',role:'admin_platform',user:{id:'platform'}};await act(async()=>root.render(React.createElement(Page)));await wait();
 check(document.body.textContent.includes('Mapa energético da plataforma')&&document.body.textContent.includes('Cliente Um')&&document.body.textContent.includes('Cliente Dois')&&document.body.textContent.includes('Cliente Sem Unidade'));
 check(!document.body.textContent.includes('Localizar unidade')&&document.querySelector('img')===null);
 const {platformMapGeoJson}=require('../app/backoffice/energy-map/platform-map-data.ts');
 check(platformMapGeoJson([{...unit(),hasUnit:true,latitude:-21,longitude:-47,locationStatus:'CONFIRMED'},{...unit('o2'),hasUnit:true,latitude:-22,longitude:-48,locationStatus:'CONFIRMED'},{...unit('o2'),hasUnit:false,latitude:-22,longitude:-48,locationStatus:'NO_UNIT'}]).features.length===2);
 await click('Ver detalhes');check(document.body.textContent.includes('Para alterar cadastros'));
 context={scope:'organization',currentOrganization:{id:'o1'}};await act(async()=>root.render(React.createElement(Page)));await wait();check(!document.body.textContent.includes('Cliente Dois')&&!document.body.textContent.includes('Cliente Sem Unidade'));
 console.log(JSON.stringify({ok:true,checks}));
 }finally{await act(async()=>root.unmount());dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
