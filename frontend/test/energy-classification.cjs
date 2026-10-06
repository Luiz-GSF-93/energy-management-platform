const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLFormElement','FormData','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
let requests=[],row={id:'u1',edit_version:0,status:'ACTIVE',name:'UC',consumer_unit_number:'123',distributor:'CPFL',address:'Rua',city:'Cidade',state:'SP',free_market:null,has_gd:null,has_bess:null};
const old=Module._load;Module._load=function(n,p,m){
 if(n==='@/app/providers')return {useAuth:()=>({hasPermission:()=>false})};
 if(n==='@/app/lib/api/users')return {getUsers:async()=>[]};
 if(n==='@/app/lib/api/client')return {apiRequest:async(u,o={})=>{if(o.method){requests.push(o.body);for(const [key,col] of Object.entries({freeMarket:'free_market',hasGd:'has_gd',hasBess:'has_bess'})){if(key in o.body.changes)row[col]=o.body.changes[key];}row.edit_version++;return row;}return u.endsWith('/edits')?[]:row;}};
 if(n==='@/app/components/ui')return {Card:({children})=>React.createElement('section',null,children),Alert:({children})=>React.createElement('p',null,children),Button:({children,...p})=>React.createElement('button',p,children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p))};
 return old.call(this,n,p,m);
};
const Editor=require('../app/backoffice/setup/RegistrationEditor.tsx').default,{mapGeoJson}=require('../app/backoffice/energy-map/map-data.ts');
const root=createRoot(document.getElementById('root'));let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
(async()=>{
 await act(async()=>{root.render(React.createElement(Editor,{kind:'consumer_units',id:'u1'}));});
 for(const [freeMarket,hasGd,hasBess] of [[false,true,null],[true,true,false],[false,true,true]]){
  for(const [key,value] of Object.entries({freeMarket,hasGd,hasBess}))document.querySelector(`[name="${key}"]`).value=value===null?'':String(value);
  document.querySelector('[name="reason"]').value='Conferido no contrato';
  await act(async()=>{document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  check(row.free_market,freeMarket);check(row.has_gd,hasGd);check(row.has_bess,hasBess);
  check(requests.at(-1).expectedVersion,requests.length-1);
 }
 const base={id:'u1',organizationId:'o1',market:'ACR',locationStatus:'CONFIRMED',latitude:-21,longitude:-47,precision:'ADDRESS'};
 check(mapGeoJson([{...base,hasGd:true,hasBess:true}],'o1').features[0].properties,{id:'u1',market:'ACR',gd:true,bess:true,approximate:false});
 check(mapGeoJson([{...base,organizationId:'o2',hasGd:true}],'o1').features.length,0);
 await act(async()=>root.unmount());console.log(JSON.stringify({ok:true,checks}));
})().catch(e=>{console.error(e);process.exitCode=1;});
