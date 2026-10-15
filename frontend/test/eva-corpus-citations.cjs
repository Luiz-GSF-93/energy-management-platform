// Real report assistant; synthetic transport, no session or provider.
const fs=require('node:fs'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const k of ['window','document','HTMLElement','HTMLTextAreaElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
let org='org_default';const original=Module._load;
const official={id:'regulation-1',title:'PdC CCEE',section:'3.1',version:'1.0',page:22,url:'https://www.ccee.org.br/test.pdf',validFrom:'2025-01-01',validTo:null};
Module._load=function(n,p,m){
 if(n==='./BotEnergyAvatar')return {__esModule:true,default:()=>React.createElement('span')};
 if(n==='@/app/providers')return {useAuth:()=>({context:{scope:'organization',user:{id:'actor'},currentOrganization:{id:org}},hasPermission:()=>true})};
 if(n==='@/app/lib/api')return {apiRequest:async()=>({state:'READY',answer:'Regra com fonte conferida.',evidence:[{id:'regulation-1',label:'Norma',value:'Regra e exceção',source:'CCEE'}],officialSources:[official,{...official,id:'invalid',url:'javascript:alert(1)'}]})};
 if(n==='@/app/components/ui')return Object.assign({},...['Button','Alert','Card'].map(x=>require('../app/components/ui/'+x+'.tsx')));
 return original.call(this,n,p,m);
};
const Component=require('../app/components/BotEnergyReports.tsx').default,root=createRoot(document.getElementById('root'));
(async()=>{try{
 await act(async()=>root.render(React.createElement(Component,{audience:'backoffice',reportId:'test-report'})));
 await act(async()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,'Qual regra da CCEE?');input.dispatchEvent(new Event('input',{bubbles:true}))});
 await act(async()=>[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Perguntar ao Bot')).click());
 assert.equal(document.querySelectorAll('a').length,1);const link=document.querySelector('a');assert.equal(link.href,official.url);assert.equal(link.rel,'noopener noreferrer');assert.ok(document.body.textContent.includes('página 22'));assert.ok(document.body.textContent.includes('versão 1.0'));
 org='other';await act(async()=>root.render(React.createElement(Component,{audience:'backoffice',reportId:'test-report'})));assert.equal(document.querySelectorAll('a').length,0);assert.ok(!document.body.textContent.includes('Regra com fonte conferida.'));
 await act(async()=>root.unmount());console.log('PASS: cited official URL, version/page, safe external link and organization reset.');
 }catch(e){console.error(e);process.exitCode=1}})();
