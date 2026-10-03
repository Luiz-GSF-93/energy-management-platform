const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','Event','MouseEvent'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let state={enabled:true,job:{id:'ocr',state:'QUEUED'},intake:null},assistantProps=null,reads=0;
const original=Module._load;
Module._load=function(name,parent,main){
 if(name==='@/app/lib/api/client')return {apiRequest:async(_p,o)=>{assert.equal(o,undefined);reads++;return state;}};
 if(name==='./OcrAssistant')return {__esModule:true,default:p=>{assistantProps=p;return null;}};
 if(name.startsWith('./Ocr')&&name!=='./OcrDocumentStatus')return {__esModule:true,default:()=>null};
 return original.call(this,name,parent,main);
};
const Status=require('../app/backoffice/documents/OcrDocumentStatus.tsx').default,root=createRoot(document.getElementById('root'));
const refresh=async()=>act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar leitura').click());
(async()=>{try{
 await act(async()=>root.render(React.createElement(Status,{id:'doc',canProcess:true,autoAssist:true})));
 assert.equal(assistantProps,null,'Never prepare before verified OCR completion');
 state={...state,job:{id:'ocr',state:'SUCCEEDED'},intake:null};await refresh();assert.equal(assistantProps,null,'Missing verified intake stays blocked');
 state={...state,intake:{decision:'REJECT_AUTOMATION',checkedAt:new Date().toISOString(),checks:[]}};await refresh();
 assert.equal(assistantProps.autoStart,true,'Read-only analysis may show rejected evidence without integrating it');assert.equal(assistantProps.autoOpen,false,'Do not interrupt operator with automatic modal');
 await act(async()=>root.render(React.createElement(Status,{id:'doc',canProcess:true,autoAssist:false})));assert.equal(assistantProps.autoStart,false,'Historical docs remain opt-in');
 assert.ok(reads>=3);await act(async()=>root.unmount());console.log('Post-OCR: wait for verified result, rejected confidence preserved, background preparation and opt-in historical records PASS');
}finally{dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
