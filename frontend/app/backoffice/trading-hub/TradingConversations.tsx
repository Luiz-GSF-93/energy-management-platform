'use client';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button,Card} from '@/app/components/ui';
import TradingConversation,{QuoteThread} from '@/app/components/TradingConversation';

export default function TradingConversations({canManage}:{canManage:boolean}){
 const {context}=useAuth(),org=context?.scope==='organization'?context.currentOrganization.id:'';
 const [data,setData]=useState<{rows:QuoteThread[];total:number;pageSize:number}>(),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[onlyPending,setOnlyPending]=useState(false);const generation=useRef(0),scope=useRef('');
 useEffect(()=>{const n=++generation.current,key=org+':'+context?.user?.id+':'+page;if(scope.current!==key){scope.current=key;setData(undefined);}setError('');if(!org)return;let busy=false;
  async function load(){if(busy||document.visibilityState==='hidden')return;busy=true;try{const r:any=await apiRequest('/api/v1/trading-hub/communications?page='+page);if(n===generation.current){if(r.organizationId!==org)throw Error('Escopo alterado.');setData(r);setError('');}}catch(e){if(n===generation.current){if([401,403].includes((e as any)?.status))setData(undefined);setError('Não foi possível consultar as conversas neste acesso. Atualize antes de enviar.');}}finally{busy=false;}}
  void load();const timer=setInterval(()=>void load(),60000);return()=>{generation.current++;clearInterval(timer);};
 },[org,context?.user?.id,page,refresh]);
 return <section id="conversas"><Card title="Perguntas e comentários das cotações"><p>Prioridade por urgência. Prazos vencidos encerram as ações; o histórico permanece no backoffice. Cada fornecedor vê somente sua conversa.</p>{error?<Alert variant="error">{error}</Alert>:null}<Button variant="secondary" onClick={()=>setRefresh(n=>n+1)}>Atualizar conversas</Button><label style={{display:'block',marginTop:12}}><input type="checkbox" checked={onlyPending} onChange={e=>setOnlyPending(e.target.checked)}/> Mostrar somente pendências do backoffice nesta página</label>{!data&&!error?<p>Consultando conversas…</p>:null}{data?.rows.filter(t=>!onlyPending||t.status==='WAITING_BACKOFFICE').map(t=><TradingConversation key={org+':'+t.id} thread={t} office disabled={!canManage||!!error} request={body=>apiRequest('/api/v1/trading-hub/communications/messages',{method:'POST',body})} onDone={()=>{setRefresh(n=>n+1);window.dispatchEvent(new Event('trading-updated'));}}/>)}{data?.rows.length===0?<p>Nenhum convite de fornecedor neste recorte.</p>:null}<div style={{display:'flex',gap:12,marginTop:16}}><Button variant="secondary" disabled={!page} onClick={()=>setPage(n=>n-1)}>Anterior</Button><span>Página {page+1} · {data?.total??'—'} convite(s)</span><Button variant="secondary" disabled={!data||(page+1)*data.pageSize>=data.total} onClick={()=>setPage(n=>n+1)}>Próxima</Button></div></Card></section>;
}
