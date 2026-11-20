// Browser deterrence, not OS capture prevention or DRM. Server export policy is authoritative.
export function installContentProtection({identity,document:doc=document,window:win=window,report=()=>{}}){
 if(!identity.content_protection_enabled)return()=>{};
 const root=doc.documentElement,mark=doc.createElement('div'),listeners=[],cooldown=new Map();
 mark.className='screen-identification';mark.setAttribute('aria-hidden','true');doc.body.append(mark);
 const signal=kind=>{const now=Date.now();if(now-(cooldown.get(kind)??0)<60000)return;cooldown.set(kind,now);try{void Promise.resolve(report(kind)).catch(()=>{});}catch{}};
 const refresh=()=>{mark.textContent=[identity.display_name??identity.subject,identity.email??'Identidade verificada',new Date().toLocaleString('pt-BR'),identity.network_address?('Conexão: '+identity.network_address):null,'EnergyOS PEE'].filter(Boolean).join(' · ');};
 function on(target,name,fn){target.addEventListener(name,fn);listeners.push(()=>target.removeEventListener(name,fn));}
 const hide=()=>{root.classList.add('private-screen');signal('window_hidden');};
 on(win,'blur',hide);on(doc,'visibilitychange',()=>{if(doc.hidden||doc.hasFocus&&!doc.hasFocus())hide();else root.classList.remove('private-screen');});on(win,'focus',()=>{if(!doc.hidden)root.classList.remove('private-screen');});
 for(const name of ['copy','cut','contextmenu','dragstart'])on(doc,name,event=>{event.preventDefault();signal('copy_command_blocked');});
 on(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&['c','p','s'].includes(event.key.toLowerCase())){event.preventDefault();signal(event.key.toLowerCase()==='p'?'print_command_blocked':'copy_command_blocked');}});
 on(win,'beforeprint',()=>{root.classList.add('private-print');signal('print_command_blocked');});on(win,'afterprint',()=>root.classList.remove('private-print'));
 refresh();if(doc.hidden||doc.hasFocus&&!doc.hasFocus())hide();const timer=win.setInterval(refresh,60000);return()=>{listeners.forEach(f=>f());win.clearInterval(timer);mark.remove();root.classList.remove('private-screen','private-print');};
}
