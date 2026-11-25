'use client';
import {FormEvent,useState} from 'react';
import Link from 'next/link';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
export default function FirstAccess(){
 const[token,setToken]=useState(''),[temporary,setTemporary]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;const form=new FormData(event.currentTarget);setError('');
  const password=String(form.get('password')||'');
  if(token&&(password!==form.get('confirmation')||password===temporary)){setError(password===temporary?'Escolha uma senha pessoal diferente da provisória.':'As senhas devem ser iguais.');return;}
  setBusy(true);
  try{
   if(!token){const result=await apiRequest<{access_token:string}>('/api/v1/auth/login',{method:'POST',authenticated:false,body:{email:String(form.get('email')),password}});if(!result.access_token)throw Error('Primeiro acesso não confirmado.');setTemporary(password);setToken(result.access_token);}
   else{await apiRequest('/api/v1/auth/accept-invite',{method:'POST',authenticated:false,headers:{Authorization:'Bearer '+token},body:{password}});setToken('');setTemporary('');setDone(true);}
  }catch(ex){setError(ex instanceof Error?ex.message:'Não foi possível concluir o primeiro acesso.');}finally{setBusy(false);}
 }
 return <main className="auth-page"><Card title="Primeiro acesso ao EnergyOS">{error?<Alert variant="error">{error}</Alert>:null}{done?<><p>Sua senha pessoal foi definida. Entre para acessar sua organização. Você poderá ativar a autenticação em dois fatores nas configurações de segurança.</p><Link href="/auth/login">Entrar no EnergyOS</Link></>:<form key={token?'personal':'temporary'} onSubmit={submit}>{token?<><p>Defina uma senha pessoal diferente da provisória.</p><Input label="Nova senha" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy}/><Input label="Confirmar nova senha" name="confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy}/></>:<><p>Informe o e-mail e a senha provisória recebidos nas boas-vindas. A senha provisória vale por 24 horas.</p><Input label="E-mail" name="email" type="email" autoComplete="username" required disabled={busy}/><Input label="Senha provisória" name="password" type="password" autoComplete="current-password" required disabled={busy}/></>}<Button type="submit" disabled={busy}>{busy?'Conferindo...':token?'Definir senha pessoal':'Continuar'}</Button><p><Link href="/auth/forgot-password">Recuperar senha</Link></p></form>}</Card></main>;
}
