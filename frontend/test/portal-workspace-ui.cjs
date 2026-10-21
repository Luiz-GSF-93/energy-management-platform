// Synthetic browser DOM integration. Never sends a document or provider message.
process.env.NEXT_PUBLIC_PORTAL_CLIENT_WORKSPACE_ENABLED='true';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/portal',pretendToBeVisual:true});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLFormElement','Event','MouseEvent','KeyboardEvent','FormData','File'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
let testFile=new dom.window.File(['%PDF-1.4 test %%EOF'],'test.pdf',{type:'application/pdf'});const NativeFormData=global.FormData;global.FormData=class extends NativeFormData{constructor(form){super(form);if(form?.querySelector('[name="file"]'))this.set('file',testFile);}};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
let calls=[],uploads=0,revision=0;const css=new Map(),units=[{id:'unit',name:'Unidade modelo'}],receipt={id:'invoice',documentId:'doc',unitId:'unit',unitName:'Unidade modelo',month:'2026-09',kind:'INVOICE',filename:'fatura-exemplo.pdf',createdAt:'2026-10-20T12:00:00Z',status:{code:'RECEIVED',label:'Enviado'},notice:null};
async function api(url,opt={}){calls.push([url,opt]);if(opt.signal?.aborted)throw Error('Aborted');
 if(url.startsWith('/api/v1/operations/notifications'))return {rows:[{key:'portal:notice',id:'notice',origin:'portal',read:false}]};
 if(url.endsWith('/context')||url.endsWith('/service-context'))return {units};
 if(url.endsWith('/invoices'))return {rows:[receipt]};
 if(url.endsWith('/preferences'))return opt.method==='POST'?{revision:++revision,body:opt.body.body}:{revision,body:{EMAIL:false,SMS:false,WHATSAPP:false}};
 if(url.endsWith('/notifications')||url.endsWith('/presentation/notices'))return {rows:[{id:'notice',title:'Novo resultado publicado',href:'/portal#financeiro',read:false,date:'2026-10-20T12:00:00Z',recordId:null}]};
 if(url.endsWith('/requests')||url.endsWith('/presentation/requests'))return {rows:[{id:'request',number:'1',title:'Conferir resultado',status:'WAITING',sector:'ANALYST',dueAt:'2026-10-22T12:00:00Z',openedAt:'2026-10-20T12:00:00Z',unitId:'unit'}]};
 if(url.endsWith('/uploads')){uploads++;return {processing:'PENDING_AUTOMATION'};}
 if(url.includes('/readout?'))return {text:'<script>alert(1)</script> Energia 100 kWh',nextOffset:null,previousOffset:null,notice:'Transcrição fictícia, sem aprovação.'};
 if(url.endsWith('/details'))return {id:'invoice',dueDate:'2026-10-15',declaration:null};
 if(url.endsWith('/payment-declaration'))return {id:'invoice',declaration:{state:opt.body.state,revision:1,actorId:'actor',declaredAt:'2026-10-21T12:00:00Z'}};
 if(url.endsWith('/file'))return {url:'https://files.invalid/signed-original.pdf'};
 throw Error('Unexpected fixture '+url);
}
const original=Module._load;Module._load=function(name,parent,main){
 if(name.endsWith('.module.css')){const file=path.resolve(path.dirname(parent.filename),name);css.set(file,fs.readFileSync(file,'utf8'));return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};}
 if(name==='next/link')return {__esModule:true,default:({children,...p})=>React.createElement('a',p,children)};
 if(name==='@/app/providers')return {useAuth:()=>({context:{scope:'organization',user:{id:'actor'},currentOrganization:{id:'org',permissions:[]}},hasPermission:()=>true})};
 if(name==='@/app/lib/api/client')return {apiRequest:api};
 if(name==='./EvidenceThread')return {__esModule:true,default:({id})=>React.createElement('p',null,'Conversa autorizada '+id)};
 if(name.startsWith('@/'))return original.call(this,path.resolve(__dirname,'..',name.slice(2)),parent,main);
 return original.call(this,name,parent,main);
};
const StaffBell=require('../app/components/OperationNotificationBell.tsx').default;
const Invoices=require('../app/components/PortalInvoices.tsx').default,Notifications=require('../app/components/PortalNotifications.tsx').default;
const root=createRoot(document.getElementById('root'));let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;},text=()=>document.body.textContent;
(async()=>{try{
 await act(async()=>root.render(React.createElement(Invoices)));
 ok(text().includes('Minhas faturas')&&text().includes('Enviado'),'real status label rendered');
 document.querySelector('[name="unitId"]').value='unit';document.querySelector('[name="month"]').value='2026-09';document.querySelector('[name="consent"]').checked=true;
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 ok(uploads===1&&text().includes('Fatura recebida'),'single upload gives visible confirmation');
 testFile=new dom.window.File([new Uint8Array(15*1024*1024+1)],'too-large.pdf',{type:'application/pdf'});await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));ok(uploads===1&&text().includes('15 MB'),'oversize file rejected before network or quota');testFile=new dom.window.File(['test'],'test.pdf',{type:'application/pdf'});
 const form=calls.find(([u,o])=>u.endsWith('/uploads'))[1].body;ok(form.get('unitId')==='unit'&&form.get('month')==='2026-09'&&form.get('consent')==='true','scope and consent transmitted, no permissions invented');
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Visualizar fatura').click());
 ok(!document.querySelector('iframe'),'PDF is not loaded inside the blocked sandboxed browser plugin');ok(document.querySelector('a[target="_blank"]').rel.includes('noopener'),'original document opens safely');
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Leitura em HTML').click());ok(!document.querySelector('script')&&document.querySelector('pre').textContent.includes('<script>'),'OCR is escaped text, never executable HTML');
 ok(text().includes('15/10/2026'),'due date comes from existing extracted evidence');
 const paymentSelect=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='PAID'));await act(async()=>{paymentSelect.value='PAID';paymentSelect.dispatchEvent(new Event('change',{bubbles:true}));});
 ok(!calls.some(([u])=>u.endsWith('/payment-declaration')),'choosing payment state does not write before explicit confirmation');
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar declaração').click());
 ok(text().includes('Cliente informou: Paga')&&text().includes('Não equivale a comprovante bancário'),'customer declaration is distinct from bank confirmation');
 await act(async()=>root.render(React.createElement(Notifications)));
 ok(text().includes('EVA · há notificações para você'),'EVA reports actual unread notifications');ok(text().includes('Prazo:'),'request deadline displayed');
 ok(!document.querySelector('[role="dialog"]'),'thread is not mounted or marked read before opening');
 await act(async()=>document.querySelector('[aria-label="Preferências de comunicação"]').click());
 ok(document.querySelector('input[type="checkbox"]')?.checked===false,'external channels start without assumed consent');
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Fechar').click());
 await act(async()=>document.querySelector('[aria-label="Visualizar status e histórico de notificações"]').click());
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Abrir atendimento').click());
 ok(text().includes('Conversa autorizada request')&&document.querySelector('[role="dialog"]'),'selected request opens existing evidence thread in modal');
 ok(document.querySelector('[name="kind"]').options.length===7,'attachment types available');
 await act(async()=>document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 ok(!document.querySelector('[role="dialog"]'),'Escape closes modal without hiding history permanently');
 await act(async()=>root.render(React.createElement(StaffBell)));ok(text().includes('EVA · 1 notificações novas de clientes'),'backoffice EVA announces authorized unread client events without an AI call');
 if(process.env.PORTAL_VISUAL_FIXTURE){await act(async()=>root.render(React.createElement(React.Fragment,null,React.createElement('h1',null,'QA — dados fictícios'),React.createElement(Invoices),React.createElement(Notifications))));for(const select of document.querySelectorAll('select'))for(const option of select.options){if(option.selected)option.setAttribute('selected','');else option.removeAttribute('selected');}fs.writeFileSync(process.env.PORTAL_VISUAL_FIXTURE,'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+fs.readFileSync(path.join(__dirname,'../app/globals.css'),'utf8')+'\n'+[...css.values()].join('\n')+'</style><body style="background:#071b2f;color:white;padding:24px">'+document.body.innerHTML+'</body></html>');}
 console.log(checks+' portal invoice/support UI checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
