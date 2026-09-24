'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
export default function AcceptInvite(){
 const invitation=useRef<{token:string|null;type:string|null}|null>(null);
 const [token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 useEffect(()=>{if(!invitation.current){const hash=new URLSearchParams(window.location.hash.slice(1));invitation.current={token:hash.get('access_token'),type:hash.get('type')};window.history.replaceState(null,'',window.location.pathname);}const value=invitation.current;const timer=window.setTimeout(()=>{if(value.token&&value.type==='invite')setToken(value.token);else setError('Convite inválido ou expirado. Solicite orientação ao administrador.');},0);return()=>window.clearTimeout(timer);},[]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy||!token)return;const f=new FormData(e.currentTarget);if(f.get('password')!==f.get('confirmation')){setError('As senhas devem ser iguais.');return;}setBusy(true);setError('');try{await apiRequest('/api/v1/auth/accept-invite',{method:'POST',authenticated:false,headers:{Authorization:'Bearer '+token},body:{password:String(f.get('password'))}});setToken('');setDone(true);}catch(ex){setError(ex instanceof Error?ex.message:'Falha ao aceitar convite.');}finally{setBusy(false);}}
 return <main className="auth-page"><Card title="Bem-vindo à Expert Energy">{error?<Alert variant="error">{error}</Alert>:null}{done?<><p>Senha definida. Entre com seu e-mail e sua nova senha.</p><Link href="/auth/login">Ir para login</Link></>:token?<form onSubmit={submit}><p>Defina sua senha pessoal para acessar as organizações às quais você foi vinculado.</p><Input label="Senha" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy}/><Input label="Confirmar senha" name="confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy}/><Button type="submit" disabled={busy}>{busy?'Salvando...':'Definir senha'}</Button></form>:null}</Card></main>;
}
