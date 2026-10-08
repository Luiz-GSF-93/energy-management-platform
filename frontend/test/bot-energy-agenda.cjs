const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const k of ['window','document','HTMLElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let api;const original=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return {apiRequest:(p,o)=>api(p,o)};if(name==='next/link')return {__esModule:true,default:({children,...p})=>React.createElement('a',p,children)};return original.call(this,name,parent,main);};
const C=require('../app/components/BotEnergyAgenda.tsx').default,root=createRoot(document.getElementById('root'));
const render=(org)=>act(async()=>root.render(React.createElement(C,{key:org,organizationId:org})));
const data=org=>({organizationId:org,reminders:[{key:'record:1:ONE_DAY',title:'Prazo de fechamento',deadline:'2026-10-09T18:00:00-03:00',days:1,source:'Agenda registrada',href:'/backoffice/operation/agenda'}],disclosure:'Fonte registrada da organização'});
(async()=>{try{
 api=async()=>data('o1');await render('o1');assert.match(document.body.textContent,/1 prazos/);await act(async()=>document.querySelector('button').click());assert.match(document.body.textContent,/Prazo de fechamento/);
 api=async()=>data('foreign');await render('o2');assert.doesNotMatch(document.body.textContent,/Prazo de fechamento/);assert.match(document.body.textContent,/indisponível/);
 let resolve;api=()=>new Promise(r=>resolve=r);await render('old');api=async()=>({organizationId:'new',reminders:[],disclosure:''});await render('new');await act(async()=>resolve(data('old')));assert.equal(document.body.textContent,'');
 api=async()=>{throw new Error('Licence unavailable');};await render('blocked');assert.match(document.body.textContent,/indisponível/);assert.doesNotMatch(document.body.textContent,/Nenhum prazo/);
 console.log('Bot-Energy agenda UI: reminder, foreign response rejection, context switch and fail-closed tests passed');
}catch(e){console.error(e);process.exitCode=1;}finally{await act(async()=>root.unmount());dom.window.close();}})();
