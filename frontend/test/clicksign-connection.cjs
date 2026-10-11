// Exercise the actual screen and API client against an in-memory HTTP transport.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','Event','MouseEvent'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
process.env.NEXT_PUBLIC_API_URL='https://api.test.invalid';
const ui={Button:({children,variant,...p})=>React.createElement('button',{type:'button',...p},children),Alert:({children})=>React.createElement('div',{role:'alert'},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p))};
const original=Module._load;
Module._load=function(name,parent,main){
 if(name==='@/app/components/ui')return ui;
 if(name==='@/app/lib/auth/session')return {session:{getOrganizationSession:()=>null}};
 if(name==='@/app/lib/auth/renew')return {freshToken:async()=>'test-token',sessionAttention:()=>{}};
 if(name==='@/app/lib/api/client')return require('../app/lib/api/client.ts');
 return original.call(this,name,parent,main);
};
let posts=[],fail=true,callsEnabled=true;
global.fetch=async(url,options)=>{
 assert.ok(url.startsWith('https://api.test.invalid/api/v1/admin/sales/clicksign-connection'));
 if(options.method!=='POST')return {ok:true,status:200,json:async()=>({page:0,total:0,rows:[],callsEnabled})};
 assert.equal(options.headers.get('Content-Type'),'application/json');
 const body=JSON.parse(options.body);
 assert.equal(typeof body,'object','HTTP JSON body must be an object, not encoded JSON text');
 assert.equal(body.accountId,'1116892');
 assert.equal(body.justification,'Verificação privada autorizada sem documentos ou convites.');
 assert.match(body.requestId,/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
 posts.push(body);
 if(fail){fail=false;throw Error('Simulated uncertain response');}
 return {ok:true,status:200,json:async()=>({state:'AUTHENTICATED'})};
};
const Screen=require('../app/backoffice/platform-sales/ClicksignConnection.tsx').default;
const root=createRoot(document.getElementById('root'));
async function click(text){const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);assert.equal(b.disabled,false);await act(async()=>b.click());}
async function fill(label,value){const e=[...document.querySelectorAll('label')].find(x=>x.firstChild.textContent===label).querySelector('input');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});}
(async()=>{try{
 await act(async()=>root.render(React.createElement(Screen)));
 await fill('ID da conta declarado no painel Clicksign','1116892');
 await click('Consultar histórico');
 await fill('Justificativa da verificação','Verificação privada autorizada sem documentos ou convites.');
 await click('Verificar conexão por leitura');
 assert.ok(document.body.textContent.includes('Resultado não confirmado'));
 await click('Consultar mesma requisição');
 assert.equal(posts.length,2);
 assert.deepEqual(posts[1],posts[0],'Retry must preserve the exact request and idempotency ID');
 assert.ok(document.body.textContent.includes('Autenticação válida'));
 callsEnabled=false;
 await click('Consultar histórico');
 assert.ok(document.body.textContent.includes('Consultas externas desligadas'));
 assert.equal([...document.querySelectorAll('button')].filter(b=>b.textContent==='Verificar conexão por leitura').length,0);
 assert.equal(posts.length,2,'Disabled calls must not issue POST');
 console.log('Clicksign UI + real API transport: object serialization, retry identity and disabled calls passed.');
 }finally{await act(async()=>root.unmount());dom.window.close();Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
