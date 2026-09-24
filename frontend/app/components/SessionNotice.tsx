'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import type {AuthContext} from '@/app/lib/api/types';
import {apiRequest} from '@/app/lib/api/client';
import {session,tokenClaims} from '@/app/lib/auth/session';
import {freshToken} from '@/app/lib/auth/renew';
export default function SessionNotice({context}:{context:AuthContext}) {
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const operationAt=useRef(0),renewing=useRef(false);
 const org=context.scope!=='global'&&context.accessMode==='platform_operation'?context.currentOrganization.id:'';
 async function renewOrganization(){
  if(!org)return;
  const old=session.getOrganizationSession();
  const result=await apiRequest<{session_id:string}>('/api/v1/admin/organizations/'+encodeURIComponent(org)+'/operate',{method:'POST'});
  if(session.getOrganizationSession()===old){session.setOrganizationSession(result.session_id);operationAt.current=Date.now();}
 }
 useEffect(()=>{
  let cancelled=false;
  const attention=(e:Event)=>setMessage((e as CustomEvent<string>).detail);
  const tick=async()=>{
   if(document.visibilityState!=='visible'||renewing.current)return;
   renewing.current=true;
   try {
    if(tokenClaims(session.getAccessToken()).sub!==context.user.id){setMessage('A conta foi alterada em outra aba. Retorne ao login com a mesma conta para continuar.');return;}
    await freshToken();
    if(cancelled)return;
    if(org&&Date.now()-operationAt.current>45*60*1000)await renewOrganization();
   }catch(e){if(!cancelled)setMessage(e instanceof Error?e.message:'Não foi possível renovar o acesso.');}
   finally{renewing.current=false;}
  };
  window.addEventListener('session-attention',attention);
  window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);
  const timer=window.setInterval(tick,30000);void tick();
  return()=>{cancelled=true;window.clearInterval(timer);window.removeEventListener('session-attention',attention);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);};
 // Renew only when the authorized identity/organization changes, never by remounting forms.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[context.user.id,org]);
 async function renew(){setBusy(true);try{await freshToken(true);await renewOrganization();setMessage('');}catch(e){setMessage(e instanceof Error?e.message:'Falha ao renovar.');}finally{setBusy(false);}}
 async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;setBusy(true);try{
  const result=await apiRequest<{access_token:string;refresh_token:string}>('/api/v1/auth/login',{method:'POST',authenticated:false,body:{email:context.user.email,password:String(new FormData(form).get('password'))}});
  if(tokenClaims(result.access_token).sub!==context.user.id)throw new Error('Use a mesma conta para continuar.');
  session.setTokens(result);await renewOrganization();form.reset();setMessage('');
 }catch(e){setMessage(e instanceof Error?e.message:'Não foi possível entrar.');}finally{setBusy(false);}}
 if(!message)return null;
 return <aside className="session-notice" aria-label="Aviso de sessão"><p role="alert">{message}</p><p>Mantenha esta página aberta. A renovação não recarrega nem apaga o formulário. Depois, tente novamente a ação que falhou.</p><button type="button" disabled={busy} onClick={()=>void renew()}>Renovar acesso</button><details><summary>Entrar novamente como {context.user.email}</summary><form onSubmit={login}><label>Senha<input className="ds-input" type="password" name="password" autoComplete="current-password" required disabled={busy}/></label><button disabled={busy}>Entrar e continuar</button></form></details></aside>;
}
