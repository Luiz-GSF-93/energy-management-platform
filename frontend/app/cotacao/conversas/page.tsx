'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import SupplierQuoteConversation from '@/app/components/SupplierQuoteConversation';
export default function Page(){
 const token=useRef('');const [valid,setValid]=useState(false),[session,setSession]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{token.current=window.location.hash.slice(1);setValid(/^[a-f0-9]{64}$/.test(token.current));// Keep the invitation fragment for e-mail verification after reopening.
},[]);
 async function challenge(){if(busy)return;setBusy(true);setError('');try{await apiRequest('/api/v1/trading-quote-conversations/challenge',{authenticated:false,cache:'no-store',method:'POST',headers:{'x-trading-token':token.current}});setSent(true);}catch{setError('Não foi possível enviar o código. Confira o prazo do link e aguarde um minuto antes de tentar novamente.');}finally{setBusy(false);}}
 async function verify(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget);setBusy(true);setError('');try{const r=await apiRequest<{session:string}>('/api/v1/trading-quote-conversations/verify',{authenticated:false,cache:'no-store',method:'POST',headers:{'x-trading-token':token.current},body:{code:String(f.get('code'))}});setSession(r.session);token.current='';}catch{setError('Código ou acesso inválido, expirado ou com limite de tentativas atingido.');}finally{setBusy(false);}}
 return <main className="backoffice-page" style={{maxWidth:1000,margin:'auto',padding:24}}><h1>Trading Hub · conversa da cotação</h1>{error?<Alert variant="error">{error}</Alert>:null}{session?<SupplierQuoteConversation session={session}/>:<Card title="Confirme seu e-mail para consultar a atualização"><p>O link é individual. O código será enviado ao mesmo contato da cotação. Após o vencimento, nenhuma ação poderá ser realizada.</p>{valid?<><Button disabled={busy} onClick={()=>void challenge()}>{sent?'Enviar outro código':'Enviar código ao meu e-mail'}</Button>{sent?<form onSubmit={verify}><Input name="code" label="Código de seis dígitos" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" disabled={busy}/><Button type="submit" disabled={busy}>Verificar e acessar conversa</Button></form>:null}</>:<p>Abra o link completo recebido por e-mail. Links expirados não podem ser reutilizados.</p>}</Card>}</main>;
}
