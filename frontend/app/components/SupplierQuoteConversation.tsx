'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from '@/app/components/ui';
import TradingConversation,{QuoteThread} from './TradingConversation';
export default function SupplierQuoteConversation({session}:{session:string}){
 const [thread,setThread]=useState<QuoteThread>(),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let stop=false;setThread(undefined);setError('');apiRequest<{rows:QuoteThread[]}>('/api/v1/trading-quote-conversations',{authenticated:false,cache:'no-store',headers:{'x-trading-session':session}}).then(r=>{if(!stop)setThread(r.rows[0]);}).catch(()=>{if(!stop)setError('Conversa indisponível: confira o prazo e reabra o link recebido por e-mail.');});return()=>{stop=true;};},[session,refresh]);
 return <section aria-label="Perguntas e comentários com o backoffice"><h2>Perguntas e comentários</h2><p>Envie dúvidas e acompanhe respostas nesta cotação. O acesso expira junto com o prazo informado.</p><Button variant="secondary" onClick={()=>setRefresh(n=>n+1)}>Atualizar conversa</Button>{error?<Alert variant="error">{error}</Alert>:null}{thread?<TradingConversation thread={thread} office={false} request={body=>apiRequest('/api/v1/trading-quote-conversations/messages',{authenticated:false,cache:'no-store',headers:{'x-trading-session':session},method:'POST',body})} onDone={()=>setRefresh(n=>n+1)}/>:!error?<p>Consultando conversa…</p>:null}</section>;
}
