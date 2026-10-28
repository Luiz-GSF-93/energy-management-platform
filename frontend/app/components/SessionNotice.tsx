'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import type {AuthContext} from '@/app/lib/api/types';
import {apiRequest} from '@/app/lib/api/client';
import {session,tokenClaims,endSession} from '@/app/lib/auth/session';
import {freshToken} from '@/app/lib/auth/renew';
export default function SessionNotice({context}:{context:AuthContext}) {
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[seconds,setSeconds]=useState<number|null>(null);
 const deadline=useRef(0),ended=useRef(false),working=useRef(false);
 const operationAt=useRef(0),renewing=useRef(false);
 const org=context.scope!=='global'&&context.accessMode==='platform_operation'?context.currentOrganization.id:'';
 async function renewOrganization(){
  if(!org)return;
  const old=session.getOrganizationSession();
  const result=await apiRequest<{session_id:string}>('/api/v1/admin/organizations/'+encodeURIComponent(org)+'/operate',{method:'POST',signal:AbortSignal.timeout(15000)});
  if(session.getOrganizationSession()===old){session.setOrganizationSession(result.session_id);operationAt.current=Date.now();}
 }
 useEffect(()=>{
  let cancelled=false;ended.current=false;
  const attention=(e:Event)=>{const d=(e as CustomEvent<string|{message:string;kind:string}>).detail;setMessage(typeof d==='string'?d:d.message);if(typeof d!=='string'&&d.kind==='expired'&&!deadline.current){deadline.current=Date.now()+10000;setSeconds(10);}};
  const renewed=()=>{deadline.current=0;setSeconds(null);setMessage('');};
  const countdown=window.setInterval(()=>{if(!deadline.current||ended.current)return;const remaining=Math.max(0,Math.ceil((deadline.current-Date.now())/1000));setSeconds(remaining);if(remaining===0&&!working.current){ended.current=true;endSession();}},250);
  const tick=async()=>{
   if(document.visibilityState!=='visible'||renewing.current||deadline.current)return;
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
  window.addEventListener('session-renewed',renewed);
  window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);
  const timer=window.setInterval(tick,30000);void tick();
  return()=>{cancelled=true;ended.current=true;window.clearInterval(timer);window.clearInterval(countdown);window.removeEventListener('session-attention',attention);window.removeEventListener('session-renewed',renewed);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);};
 // Renew only when the authorized identity/organization changes, never by remounting forms.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[context.user.id,org]);
 async function renew(){working.current=true;setBusy(true);try{await freshToken(true);if(ended.current)return;await renewOrganization();deadline.current=0;setSeconds(null);setMessage('');}catch(e){setMessage(e instanceof Error?e.message:'Falha ao renovar.');}finally{working.current=false;setBusy(false);}}
 async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,before=session.getAccessToken();working.current=true;setBusy(true);try{
  const result=await apiRequest<{access_token:string;refresh_token:string}>('/api/v1/auth/login',{method:'POST',authenticated:false,signal:AbortSignal.timeout(15000),body:{email:context.user.email,password:String(new FormData(form).get('password'))}});
  if(ended.current||session.getAccessToken()!==before||tokenClaims(result.access_token).sub!==context.user.id)throw new Error('A sessão mudou. Entre novamente para continuar.');
  session.setTokens(result);await renewOrganization();form.reset();setMessage('');
 }catch(e){setMessage(e instanceof Error?e.message:'Não foi possível entrar.');}finally{working.current=false;setBusy(false);}}
 if(!message)return null;
 return <aside className="session-notice" aria-label="Aviso de sessão"><p role="alert">{message}</p>{seconds!==null?<p role="status">Renove o acesso em {seconds} segundos. Sem renovação, a sessão será encerrada e você voltará ao login.</p>:<p>A sessão é temporária. Sua senha não é armazenada pelo EnergyOS.</p>}<button type="button" disabled={busy} onClick={()=>void renew()}>Renovar acesso</button><details><summary>Entrar novamente como {context.user.email}</summary><form onSubmit={login}><label>Senha<input className="ds-input" type="password" name="password" autoComplete="current-password" required disabled={busy}/></label><button disabled={busy}>Entrar e continuar</button></form></details></aside>;
}
