const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const k of ['window','document','HTMLElement','HTMLInputElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
const orig=Module._load;Module._load=function(name,parent,main){if(name==='@/app/components/ui')return {Button:({children,variant,...props})=>React.createElement('button',props,children),Input:({label,...props})=>React.createElement('label',null,label,React.createElement('input',props))};return orig.call(this,name,parent,main);};
const C=require('../app/backoffice/setup/CustomerContacts.tsx').default,root=createRoot(document.getElementById('root'));let value=[],checks=0;
const render=()=>act(async()=>root.render(React.createElement(C,{value,onChange:v=>{value=v;},disabled:false}))),ok=v=>{assert.ok(v);checks++;};
(async()=>{try{
 await render();ok(value.length===0&&document.body.textContent.includes('não envia mensagens'));
 await act(async()=>document.querySelector('button').click());await render();ok(value.length===1&&value[0].channels.length===0&&value[0].id);
 const id=value[0].id;await act(async()=>document.querySelector('input[type="checkbox"]').click());await render();ok(value[0].active===false&&value[0].id===id);
 await act(async()=>document.querySelectorAll('input[type="checkbox"]')[1].click());await render();ok(value[0].channels.join()==='email'&&document.querySelector('input[type="email"]').required);
 await act(async()=>document.querySelectorAll('input[type="checkbox"]')[3].click());await render();ok(value[0].channels.includes('sms')&&document.querySelector('input[placeholder]').required);
 await act(async()=>document.querySelector('button').click());await render();ok(value.length===0);
 value=Array.from({length:50},(_,i)=>({id:String(i),name:'Contato',department:'',email:'a@example.invalid',phone:'',active:true,channels:['email']}));await render();ok([...document.querySelectorAll('button')].find(b=>b.textContent==='Acrescentar contato').disabled);
 value=[{...value[0],name:'<script>bad</script>'}];await render();ok(!document.querySelector('script'));
 await act(async()=>root.unmount());console.log(checks+' contact UI checks passed');
 }catch(e){console.error(e);process.exitCode=1;}finally{dom.window.close();}})();
