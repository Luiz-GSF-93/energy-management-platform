'use client';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button,Card} from '@/app/components/ui';
import TradingConversation,{QuoteThread,urgencyLabels} from '@/app/components/TradingConversation';
type Company={id:string;supplier:string;rounds:number;active:number;pending:number;urgency:number};
type Page<T>={organizationId:string;rows:T[];total:number;pageSize:number};
type Thread=QuoteThread&{messageTotal:number};
const endpoint='/api/v1/trading-hub/communications/companies';
function CompanyDialog({company,org,canManage,onClose,onUpdated}:{company:Company;org:string;canManage:boolean;onClose:()=>void;onUpdated:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),generation=useRef(0);
 const [tab,setTab]=useState<'active'|'history'>('active'),[page,setPage]=useState(0),[data,setData]=useState<Page<Thread>>(),[selected,setSelected]=useState(''),[messagePage,setMessagePage]=useState(0),[detail,setDetail]=useState<Thread>(),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{ref.current?.showModal();},[]);
 useEffect(()=>{const n=++generation.current;setError('');setData(undefined);setDetail(undefined);setSelected('');setMessagePage(0);
  apiRequest<Page<Thread>>(endpoint+'/'+company.id+'?page='+page).then(r=>{if(n!==generation.current)return;if(r.organizationId!==org)throw Error('Escopo alterado');setData(r);}).catch(()=>{if(n===generation.current)setError('Não foi possível consultar as rodadas desta empresa.');});
  return()=>{generation.current++;};
 },[org,company.id,page,refresh]);
 useEffect(()=>{let current=true;setDetail(undefined);if(!selected)return;
  apiRequest<Page<Thread>>(endpoint+'/'+company.id+'?threadId='+selected+'&messagePage='+messagePage).then(r=>{if(!current)return;if(r.organizationId!==org)throw Error('Escopo alterado');setDetail(r.rows[0]);setError('');}).catch(()=>{if(current)setError('Histórico indisponível. Atualize antes de enviar.');});return()=>{current=false;};
 },[org,company.id,selected,messagePage,refresh]);
 const rows=data?.rows.filter(t=>(t.status==='EXPIRED'||Date.parse(t.expiresAt)<=Date.now())===(tab==='history'))??[];
 return <dialog ref={ref} aria-label={'Conversas com '+company.supplier} onCancel={onClose} style={{width:'min(920px,94vw)',maxHeight:'88vh',overflow:'auto'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}><h2>{company.supplier}</h2><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
  <div role="tablist" aria-label="Conversas da empresa" style={{display:'flex',gap:12}}>{(['active','history'] as const).map(v=><button key={v} type="button" role="tab" aria-selected={tab===v} onClick={()=>{setTab(v);setSelected('');setDetail(undefined);setMessagePage(0);}}>{v==='active'?'Rodadas abertas':'Histórico de perguntas e comentários'}</button>)}</div>
  <p>{tab==='history'?'Negociações encerradas: registro imutável, disponível somente para consulta.':'Selecione uma rodada aberta para ler, responder ou enviar um comentário. As mensagens enviadas são preservadas; correções devem ser feitas em uma nova mensagem.'}</p>
  {error?<Alert variant="error">{error}</Alert>:null}{!data&&!error?<p>Consultando rodadas…</p>:null}
  <label>Rodada de negociação<select className="ds-input" value={selected} onChange={e=>{setSelected(e.target.value);setMessagePage(0);}}><option value="">Selecione</option>{rows.map(t=><option key={t.id} value={t.id}>{t.title} · {t.email} · {urgencyLabels[t.urgency]}</option>)}</select></label>
  {data&&!rows.length?<p>Nenhuma rodada {tab==='history'?'encerrada':'aberta'} nesta página.</p>:null}
  {data&&data.total>data.pageSize?<div style={{display:'flex',gap:12,marginTop:12}}><Button variant="secondary" disabled={!page} onClick={()=>setPage(p=>p-1)}>Rodadas anteriores</Button><span>Página {page+1}</span><Button variant="secondary" disabled={(page+1)*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>Mais rodadas</Button></div>:null}
  {detail?<><TradingConversation key={org+':'+detail.id} thread={detail} office readOnly={tab==='history'} disabled={!canManage||!!error} request={body=>apiRequest('/api/v1/trading-hub/communications/messages',{method:'POST',body})} onDone={()=>{setRefresh(v=>v+1);onUpdated();}}/>
   {detail.messageTotal>50?<div style={{display:'flex',gap:12,marginTop:12}}><Button variant="secondary" disabled={!messagePage} onClick={()=>setMessagePage(p=>p-1)}>Mensagens mais recentes</Button><span>Histórico · página {messagePage+1}</span><Button variant="secondary" disabled={(messagePage+1)*50>=detail.messageTotal} onClick={()=>setMessagePage(p=>p+1)}>Mensagens anteriores</Button></div>:null}</>:null}
 </dialog>;
}
export default function TradingCompanyConversations({canManage}:{canManage:boolean}){
 const {context}=useAuth(),org=context?.scope==='organization'?context.currentOrganization.id:'';
 const [data,setData]=useState<Page<Company>>(),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[onlyPending,setOnlyPending]=useState(false),[selected,setSelected]=useState<Company>();const generation=useRef(0);
 useEffect(()=>{setSelected(undefined);setPage(0);setData(undefined);},[org,context?.user?.id]);
 useEffect(()=>{const n=++generation.current;setData(undefined);setError('');if(!org)return;let busy=false;
  async function load(){if(busy||document.visibilityState==='hidden')return;busy=true;try{const r=await apiRequest<Page<Company>>(endpoint+'?page='+page);if(n===generation.current){if(r.organizationId!==org)throw Error('Escopo alterado');setData(r);setError('');}}catch{if(n===generation.current){setData(undefined);setSelected(undefined);setError('Não foi possível consultar as empresas neste acesso.');}}finally{busy=false;}}
  void load();const timer=setInterval(()=>void load(),60000);return()=>{generation.current++;clearInterval(timer);};
 },[org,context?.user?.id,page,refresh]);
 return <section id="conversas"><Card title="Perguntas e comentários das cotações"><p>Selecione uma empresa para conversar ou consultar o histórico das negociações.</p>{error?<Alert variant="error">{error}</Alert>:null}<Button variant="secondary" onClick={()=>setRefresh(n=>n+1)}>Atualizar conversas</Button><label style={{display:'block',marginTop:12}}><input type="checkbox" checked={onlyPending} onChange={e=>setOnlyPending(e.target.checked)}/> Mostrar somente pendências do backoffice nesta página</label>
  {!data&&!error?<p>Consultando empresas…</p>:null}<div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}} aria-label="Empresas das cotações"><thead><tr><th>Empresa</th><th>Conversas abertas</th><th>Pendências</th><th>Conversa</th></tr></thead><tbody>{data?.rows.filter(c=>!onlyPending||c.pending>0).map(c=><tr key={c.id} style={{borderTop:'1px solid #31516c'}}><td style={{padding:'10px 8px 10px 0',overflowWrap:'anywhere'}}><strong>{c.supplier}</strong><br/><small>{urgencyLabels[c.urgency]}</small></td><td style={{padding:8}}>{c.active}</td><td style={{padding:8}}>{c.pending}</td><td style={{padding:'10px 0 10px 8px'}}><Button variant="secondary" aria-label={'Abrir '+c.supplier} onClick={()=>setSelected(c)}>Abrir</Button></td></tr>)}</tbody></table></div>
  {data&&!data.rows.length?<p>Nenhum fornecedor neste recorte.</p>:null}<div style={{display:'flex',gap:12,marginTop:16}}><Button variant="secondary" disabled={!page} onClick={()=>setPage(n=>n-1)}>Anterior</Button><span>Página {page+1} · {data?.total??'—'} empresa(s)</span><Button variant="secondary" disabled={!data||(page+1)*data.pageSize>=data.total} onClick={()=>setPage(n=>n+1)}>Próxima</Button></div>
 </Card>{selected?<CompanyDialog key={org+':'+selected.id} company={selected} org={org} canManage={canManage} onClose={()=>setSelected(undefined)} onUpdated={()=>{setRefresh(n=>n+1);window.dispatchEvent(new Event('trading-updated'));}}/>:null}</section>;
}
